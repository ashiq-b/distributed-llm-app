//! dl-engine: safe Rust API over the pinned llama.cpp (see engine/LLAMA_CPP_VERSION)
//! and our thin C wrapper in engine/cpp.

mod ffi;
mod host;
mod stats;
mod worker;

use std::ffi::CStr;

pub use host::{ChatMessage, ChatRole, GenParams, GenSummary, Host, LoadReport, StopReason, CONNECT_TIMEOUT};
pub use stats::DeviceShare;
pub use worker::{Worker, WorkerConfig, WorkerStatus};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("cannot listen on {0} (address in use or invalid)")]
    Bind(String),
    #[error("a worker is already running in this app")]
    AlreadyRunning,
    #[error("no usable compute device")]
    NoDevice,
    #[error("{0}")]
    Start(String),
    #[error("cannot reach worker {0}")]
    Connect(String),
    #[error("{0}")]
    Load(String),
    #[error("not enough memory on a device to hold its share of the model")]
    OutOfMemory,
    #[error("lost connection to worker {0}")]
    WorkerLost(String),
    #[error("{0}")]
    ContextFull(String),
    #[error("generation failed: {0}")]
    Generate(String),
}

/// RPC protocol version of the linked llama.cpp, e.g. "10.0.0".
/// Devices must report the same version to work together.
pub fn rpc_proto_version() -> String {
    unsafe { CStr::from_ptr(ffi::dl_rpc_proto_version()) }.to_string_lossy().into_owned()
}

/// The llama.cpp this engine is built from, as pinned in `engine/LLAMA_CPP_VERSION`:
/// (release tag, commit). Every platform builds from the same pin.
pub fn llama_cpp_pin() -> (&'static str, &'static str) {
    const PIN: &str = include_str!("../LLAMA_CPP_VERSION");
    let field = |key: &str| {
        PIN.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix('=')).map(str::trim).unwrap_or("unknown")
    };
    (field("tag"), field("commit"))
}

/// Free memory (MiB) of this device's default compute device, if known.
pub fn device_free_mb() -> Option<u64> {
    u64::try_from(unsafe { ffi::dl_device_free_mb() }).ok()
}
