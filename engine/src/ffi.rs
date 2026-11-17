//! Raw bindings to engine/cpp/dl_engine.h. Keep in sync with the header.
use std::os::raw::{c_char, c_int, c_longlong};

pub const DL_OK: c_int = 0;
pub const DL_ERR_ARGS: c_int = -1;
pub const DL_ERR_BIND: c_int = -2;
pub const DL_ERR_ALREADY_RUNNING: c_int = -3;
pub const DL_ERR_START: c_int = -4;
pub const DL_ERR_NO_DEVICE: c_int = -5;

#[repr(C)]
pub struct dl_worker_status_t {
    pub running: c_int,
    pub endpoint: [c_char; 64],
    pub device: [c_char; 64],
    pub free_mb: c_longlong,
}

extern "C" {
    pub fn dl_worker_start(bind_host: *const c_char, port: c_int, cache_dir: *const c_char, n_threads: c_int) -> c_int;
    pub fn dl_worker_status(out: *mut dl_worker_status_t) -> c_int;
    pub fn dl_rpc_proto_version() -> *const c_char;
    pub fn dl_device_free_mb() -> c_longlong;
}
