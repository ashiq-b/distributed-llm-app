use std::ffi::{CStr, CString};
use std::path::PathBuf;
use std::ptr;

use crate::{ffi, EngineError};

/// How to run this device as an RPC worker.
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    /// Address to listen on, e.g. "0.0.0.0" for the LAN or "127.0.0.1" for local only.
    pub bind_host: String,
    pub port: u16,
    /// Directory for llama.cpp's tensor cache (faster reloads); `None` disables it.
    pub cache_dir: Option<PathBuf>,
    /// CPU threads for the worker; `None` = half the cores.
    pub threads: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WorkerStatus {
    pub running: bool,
    /// "host:port" as bound.
    pub endpoint: String,
    /// Human-readable compute device, e.g. "Apple M5".
    pub device: String,
    /// Free memory of that device in MiB, if the backend reports it.
    pub free_mb: Option<u64>,
}

/// A running llama.cpp RPC server in this process.
///
/// There is no `stop`: llama.cpp v1.0.0 has no API to stop its RPC server, so a
/// worker runs until the app exits. Only one worker can exist per process.
#[derive(Debug)]
pub struct Worker {
    _private: (),
}

impl Worker {
    pub fn start(config: WorkerConfig) -> Result<Worker, EngineError> {
        let host = CString::new(config.bind_host.clone()).map_err(|_| EngineError::Bind("host contains NUL".into()))?;
        let cache = match &config.cache_dir {
            Some(dir) => {
                std::fs::create_dir_all(dir).map_err(|e| EngineError::Start(format!("cache dir {}: {e}", dir.display())))?;
                Some(CString::new(dir.to_string_lossy().as_bytes()).map_err(|_| EngineError::Start("cache dir contains NUL".into()))?)
            }
            None => None,
        };
        let threads = config.threads.map(|t| t as i32).unwrap_or(0);
        let rc = unsafe {
            ffi::dl_worker_start(host.as_ptr(), i32::from(config.port), cache.as_ref().map_or(ptr::null(), |c| c.as_ptr()), threads)
        };
        let endpoint = format!("{}:{}", config.bind_host, config.port);
        match rc {
            ffi::DL_OK => Ok(Worker { _private: () }),
            ffi::DL_ERR_BIND => Err(EngineError::Bind(endpoint)),
            ffi::DL_ERR_ALREADY_RUNNING => Err(EngineError::AlreadyRunning),
            ffi::DL_ERR_NO_DEVICE => Err(EngineError::NoDevice),
            ffi::DL_ERR_ARGS => Err(EngineError::Start(format!("invalid arguments for {endpoint}"))),
            ffi::DL_ERR_START => Err(EngineError::Start(format!("RPC server failed to start on {endpoint}"))),
            other => Err(EngineError::Start(format!("unexpected engine error {other} starting {endpoint}"))),
        }
    }

    pub fn status(&self) -> WorkerStatus {
        let mut raw = ffi::dl_worker_status_t { running: 0, endpoint: [0; 64], device: [0; 64], free_mb: -1 };
        unsafe { ffi::dl_worker_status(&mut raw) };
        WorkerStatus {
            running: raw.running != 0,
            endpoint: unsafe { CStr::from_ptr(raw.endpoint.as_ptr()) }.to_string_lossy().into_owned(),
            device: unsafe { CStr::from_ptr(raw.device.as_ptr()) }.to_string_lossy().into_owned(),
            free_mb: u64::try_from(raw.free_mb).ok(),
        }
    }
}
