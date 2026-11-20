use std::ffi::{CStr, CString};
use std::net::{TcpStream, ToSocketAddrs};
use std::ops::ControlFlow;
use std::os::raw::{c_char, c_float, c_int, c_void};
use std::path::Path;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::stats::{read_shares, DeviceShare};
use crate::{ffi, EngineError};

/// Time allowed to reach each RPC worker before a load gives up.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

static HOST_ACTIVE: AtomicBool = AtomicBool::new(false);

/// A model loaded on this device, split across its GPU and zero or more RPC workers.
/// One per process; dropping it unloads the model.
#[derive(Debug)]
pub struct Host {
    _private: (),
}

impl Host {
    /// Load `model` split across this device and `endpoints` ("host:port").
    /// `split` optionally weights each device (RPC workers in order, then this device);
    /// `None` lets llama.cpp split by free memory.
    pub fn load(
        model: &Path,
        endpoints: &[String],
        split: Option<&[f32]>,
        mut on_progress: impl FnMut(f32),
    ) -> Result<Host, EngineError> {
        if !model.is_file() {
            return Err(EngineError::Load(format!("model file not found: {}", model.display())));
        }
        // llama.cpp aborts the process on an unreachable RPC server, so check every worker first.
        for ep in endpoints {
            check_reachable(ep)?;
        }
        if HOST_ACTIVE.swap(true, Ordering::SeqCst) {
            return Err(EngineError::Load("a model is already loaded; unload it first".into()));
        }

        let path = CString::new(model.to_string_lossy().as_bytes()).map_err(|_| EngineError::Load("path contains NUL".into()));
        let eps: Result<Vec<CString>, _> = endpoints.iter().map(|e| CString::new(e.as_str())).collect();
        let (path, eps) = match (path, eps) {
            (Ok(p), Ok(e)) => (p, e),
            (Err(e), _) => return Err(release(e)),
            (_, Err(_)) => return Err(release(EngineError::Connect("endpoint contains NUL".into()))),
        };
        let ep_ptrs: Vec<*const i8> = eps.iter().map(|c| c.as_ptr()).collect();

        let mut progress: &mut dyn FnMut(f32) = &mut on_progress;
        let rc = unsafe {
            ffi::dl_host_load(
                path.as_ptr(),
                if ep_ptrs.is_empty() { ptr::null() } else { ep_ptrs.as_ptr() },
                ep_ptrs.len() as i32,
                split.map_or(ptr::null(), |s| s.as_ptr()),
                Some(progress_trampoline),
                &mut progress as *mut &mut dyn FnMut(f32) as *mut c_void,
            )
        };
        match rc {
            ffi::DL_OK => Ok(Host { _private: () }),
            ffi::DL_ERR_OOM => Err(release(EngineError::OutOfMemory)),
            _ => Err(release(EngineError::Load(last_error()))),
        }
    }

    /// Each device's share of the model, in load order (RPC workers first, this device last).
    pub fn device_shares(&self) -> Vec<DeviceShare> {
        read_shares()
    }

    /// Generate the assistant's reply to `messages`, streaming text to `on_token`.
    /// Reasoning, when on, is streamed too, inside `<think>…</think>`.
    /// Return `ControlFlow::Break` from the callback (or call [`Host::cancel`]) to stop early.
    /// After `Err(WorkerLost)` the model is unusable: drop this `Host` and load again.
    pub fn generate(
        &self,
        messages: &[ChatMessage],
        params: GenParams,
        mut on_token: impl FnMut(&str) -> ControlFlow<()>,
    ) -> Result<GenSummary, EngineError> {
        let to_c = |s: &str| CString::new(s.replace('\0', "")).expect("NUL removed");
        let roles: Vec<CString> = messages.iter().map(|m| to_c(m.role.as_str())).collect();
        let contents: Vec<CString> = messages.iter().map(|m| to_c(&m.content)).collect();
        let role_ptrs: Vec<*const c_char> = roles.iter().map(|c| c.as_ptr()).collect();
        let content_ptrs: Vec<*const c_char> = contents.iter().map(|c| c.as_ptr()).collect();

        let mut text = String::new();
        let mut on_piece = |p: &str| {
            text.push_str(p);
            on_token(p)
        };
        let mut stream = Utf8Stream { pending: Vec::new(), on_token: &mut on_piece };
        let mut n_tokens: c_int = 0;
        let started = Instant::now();
        let rc = unsafe {
            ffi::dl_host_generate(
                role_ptrs.as_ptr(),
                content_ptrs.as_ptr(),
                role_ptrs.len() as c_int,
                params.max_tokens.min(i32::MAX as u32) as c_int,
                params.temperature,
                params.seed,
                params.think as c_int,
                Some(token_trampoline),
                &mut stream as *mut Utf8Stream as *mut c_void,
                &mut n_tokens,
            )
        };
        stream.flush();
        drop(stream);
        let summary = |stopped| GenSummary { tokens: n_tokens.max(0) as u32, millis: started.elapsed().as_millis() as u64, stopped };
        match rc {
            ffi::DL_STOP_EOS => Ok(summary(StopReason::Eos)),
            ffi::DL_STOP_CANCELLED => Ok(summary(StopReason::Cancelled)),
            ffi::DL_STOP_MAX_TOKENS if still_thinking(&text) => Ok(summary(StopReason::MaxTokensWhileThinking)),
            ffi::DL_STOP_MAX_TOKENS => Ok(summary(StopReason::MaxTokens)),
            ffi::DL_ERR_WORKER_LOST => Err(EngineError::WorkerLost(last_error())),
            ffi::DL_ERR_CONTEXT => Err(EngineError::ContextFull(last_error())),
            ffi::DL_ERR_NOT_LOADED => Err(EngineError::Load("no model loaded".into())),
            _ => Err(EngineError::Generate(last_error())),
        }
    }

    /// Stop a running [`Host::generate`] after its current token. Safe from any thread.
    pub fn cancel(&self) {
        unsafe { ffi::dl_host_cancel() };
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatRole::System => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct GenParams {
    pub max_tokens: u32,
    /// 0 = greedy (deterministic).
    pub temperature: f32,
    pub seed: u32,
    /// Let the model reason before answering. Off: it answers at once (models without
    /// a thinking switch ignore this).
    pub think: bool,
}

impl Default for GenParams {
    fn default() -> Self {
        GenParams { max_tokens: 2048, temperature: 0.7, seed: 0, think: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum StopReason {
    Eos,
    MaxTokens,
    /// The length ran out before the reasoning finished, so there is no answer yet.
    MaxTokensWhileThinking,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct GenSummary {
    pub tokens: u32,
    pub millis: u64,
    pub stopped: StopReason,
}

/// Re-assembles llama.cpp's byte pieces (which can split a UTF-8 character) into valid text.
struct Utf8Stream<'a> {
    pending: Vec<u8>,
    on_token: &'a mut dyn FnMut(&str) -> ControlFlow<()>,
}

impl Utf8Stream<'_> {
    /// Emit the longest valid UTF-8 prefix; keep an incomplete trailing character for later.
    fn push(&mut self, bytes: &[u8]) -> ControlFlow<()> {
        self.pending.extend_from_slice(bytes);
        let valid = match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(), // incomplete at the end: wait
            Err(_) => self.pending.len(),                          // invalid bytes: emit lossily
        };
        if valid == 0 {
            return ControlFlow::Continue(());
        }
        let chunk: Vec<u8> = self.pending.drain(..valid).collect();
        (self.on_token)(&String::from_utf8_lossy(&chunk))
    }

    fn flush(&mut self) {
        if !self.pending.is_empty() {
            let rest = std::mem::take(&mut self.pending);
            let _ = (self.on_token)(&String::from_utf8_lossy(&rest));
        }
    }
}

unsafe extern "C" fn token_trampoline(piece: *const c_char, user: *mut c_void) -> c_int {
    let stream = &mut *(user as *mut Utf8Stream);
    match stream.push(CStr::from_ptr(piece).to_bytes()) {
        ControlFlow::Continue(()) => 0,
        ControlFlow::Break(()) => 1,
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        unsafe { ffi::dl_host_unload() };
        HOST_ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// The text opened a `<think>` block that it never closed.
fn still_thinking(text: &str) -> bool {
    text.rfind("<think>") > text.rfind("</think>")
}

fn release(err: EngineError) -> EngineError {
    HOST_ACTIVE.store(false, Ordering::SeqCst);
    err
}

fn check_reachable(endpoint: &str) -> Result<(), EngineError> {
    let unreachable = || EngineError::Connect(endpoint.to_string());
    let addrs = endpoint.to_socket_addrs().map_err(|_| unreachable())?;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).is_ok() {
            return Ok(());
        }
    }
    Err(unreachable())
}

fn last_error() -> String {
    let msg = unsafe { CStr::from_ptr(ffi::dl_last_error()) }.to_string_lossy().trim().to_string();
    if msg.is_empty() { "model failed to load".into() } else { msg }
}

unsafe extern "C" fn progress_trampoline(frac: c_float, user: *mut c_void) {
    let cb = &mut *(user as *mut &mut dyn FnMut(f32));
    cb(frac);
}
