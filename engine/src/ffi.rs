//! Raw bindings to engine/cpp/dl_engine.h. Keep in sync with the header.
#![allow(non_camel_case_types, dead_code)]
use std::os::raw::{c_char, c_double, c_float, c_int, c_longlong, c_void};

pub const DL_OK: c_int = 0;
pub const DL_ERR_ARGS: c_int = -1;
pub const DL_ERR_BIND: c_int = -2;
pub const DL_ERR_ALREADY_RUNNING: c_int = -3;
pub const DL_ERR_START: c_int = -4;
pub const DL_ERR_NO_DEVICE: c_int = -5;
pub const DL_ERR_LOAD: c_int = -6;
pub const DL_ERR_OOM: c_int = -7;
pub const DL_ERR_WORKER_LOST: c_int = -8;
pub const DL_ERR_NOT_LOADED: c_int = -9;
pub const DL_ERR_CONTEXT: c_int = -10;
pub const DL_ERR_DECODE: c_int = -11;

pub const DL_STOP_EOS: c_int = 0;
pub const DL_STOP_CANCELLED: c_int = 1;
pub const DL_STOP_MAX_TOKENS: c_int = 2;

pub type dl_token_cb = Option<unsafe extern "C" fn(piece: *const c_char, user: *mut c_void) -> c_int>;

pub type dl_progress_cb = Option<unsafe extern "C" fn(frac: c_float, user: *mut c_void)>;

#[repr(C)]
pub struct dl_device_share_t {
    pub name: [c_char; 64],
    pub endpoint: [c_char; 64],
    pub is_remote: c_int,
    pub layer_first: c_int,
    pub layer_last: c_int,
    pub buffer_mib: c_double,
}

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
    pub fn dl_worker_add_model(gguf_path: *const c_char, index_dir: *const c_char) -> c_int;
    pub fn dl_worker_bytes_from_models() -> u64;
    pub fn dl_rpc_proto_version() -> *const c_char;
    pub fn dl_device_free_mb() -> c_longlong;

    pub fn dl_host_load(
        model_path: *const c_char,
        endpoints: *const *const c_char,
        n_endpoints: c_int,
        tensor_split: *const c_float,
        cb: dl_progress_cb,
        user: *mut c_void,
    ) -> c_int;
    pub fn dl_stats_devices(out: *mut dl_device_share_t, max: c_int) -> c_int;
    pub fn dl_host_unload();
    pub fn dl_last_error() -> *const c_char;

    pub fn dl_host_generate(
        roles: *const *const c_char,
        contents: *const *const c_char,
        n_messages: c_int,
        max_tokens: c_int,
        temperature: c_float,
        seed: std::os::raw::c_uint,
        think: c_int,
        cb: dl_token_cb,
        user: *mut c_void,
        n_tokens: *mut c_int,
    ) -> c_int;
    pub fn dl_host_cancel();
    pub fn dl_host_upload_stats(sent: *mut u64, cached: *mut u64);
}
