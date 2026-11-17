use std::ffi::{CStr, CString};
use std::net::{TcpStream, ToSocketAddrs};
use std::os::raw::{c_float, c_void};
use std::path::Path;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

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
}

impl Drop for Host {
    fn drop(&mut self) {
        unsafe { ffi::dl_host_unload() };
        HOST_ACTIVE.store(false, Ordering::SeqCst);
    }
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
