// dl_engine — thin C ABI over the pinned llama.cpp, used by the Rust crate `dl-engine`.
// All functions are safe to call from any thread unless noted.
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Return codes
#define DL_OK                    0
#define DL_ERR_ARGS             -1
#define DL_ERR_BIND             -2   // could not bind host:port (in use, bad address)
#define DL_ERR_ALREADY_RUNNING  -3   // one RPC worker per process
#define DL_ERR_START            -4   // server exited or never started listening
#define DL_ERR_NO_DEVICE        -5   // no usable compute device

typedef struct {
    int       running;       // 1 while the RPC server is accepting connections
    char      endpoint[64];  // "host:port" as bound
    char      device[64];    // human-readable device, e.g. "Apple M5"
    long long free_mb;       // free memory of that device in MiB, -1 if unknown
} dl_worker_status_t;

// Start llama.cpp's RPC server on a background thread and return once it is
// listening. cache_dir may be NULL (no tensor cache); n_threads <= 0 = default.
// There is no stop: llama.cpp v1.0.0 exposes none, so the worker lives until
// the process exits.
int dl_worker_start(const char * bind_host, int port, const char * cache_dir, int n_threads);

// Fill *out with the worker's current status. Returns DL_OK, or DL_ERR_ARGS.
int dl_worker_status(dl_worker_status_t * out);

// RPC protocol version of the linked llama.cpp, e.g. "10.0.0". Static string.
const char * dl_rpc_proto_version(void);

// Free memory (MiB) of the default compute device (GPU if present, else CPU); -1 if unknown.
long long dl_device_free_mb(void);

#ifdef __cplusplus
}
#endif
