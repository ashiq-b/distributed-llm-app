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
#define DL_ERR_LOAD             -6   // model failed to load (see dl_last_error)
#define DL_ERR_OOM              -7   // a device could not allocate its share
#define DL_ERR_WORKER_LOST      -8   // an RPC worker disconnected (endpoint in dl_last_error)
#define DL_ERR_NOT_LOADED       -9   // no model loaded
#define DL_ERR_CONTEXT         -10   // conversation does not fit the context window
#define DL_ERR_DECODE          -11   // llama_decode failed (see dl_last_error)

// dl_host_generate stop reasons (>= 0)
#define DL_STOP_EOS              0
#define DL_STOP_CANCELLED        1
#define DL_STOP_MAX_TOKENS       2

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

// ---- Host ---------------------------------------------------------------

typedef void (*dl_progress_cb)(float frac, void * user);

typedef struct {
    char   name[64];       // device description, e.g. "Apple M5"
    char   endpoint[64];   // "host:port" for RPC devices, "" for local
    int    is_remote;      // 1 = RPC worker, 0 = this device
    int    layer_first;    // inclusive; -1 if llama.cpp did not report it
    int    layer_last;     // inclusive; index == n_layer means the output layer
    double buffer_mib;     // model weights held, as reported by llama.cpp; < 0 if unknown
} dl_device_share_t;

// Load a model split across this device's GPU and the given RPC workers
// (endpoints "host:port"; callers must check they are reachable first, since
// llama.cpp aborts on unreachable RPC servers). tensor_split may be NULL
// (llama.cpp splits by free memory) or hold one weight per device in load
// order: RPC devices first, then local. Unloads any previous model.
int dl_host_load(const char * model_path, const char ** endpoints, int n_endpoints,
                 const float * tensor_split, dl_progress_cb cb, void * user);

// Per-device share of the loaded model, in load order. Returns the count written.
int dl_stats_devices(dl_device_share_t * out, int max);

void dl_host_unload(void);

// Called with each generated piece of UTF-8 text (a piece may end mid-character).
// Return 0 to continue, non-zero to stop.
typedef int (*dl_token_cb)(const char * piece, void * user);

// Run a chat turn on the loaded model. roles/contents are parallel arrays
// ("system" | "user" | "assistant"). The model's chat template is applied and the
// KV cache is reset each call. temperature <= 0 means greedy. think = 0 switches the
// model's reasoning off where its template has a switch. The answer is capped at
// max_tokens or what the context has left, whichever is smaller. On return,
// *n_tokens (may be NULL) holds the number of tokens generated.
// Returns DL_STOP_* (>= 0) or a DL_ERR_* (< 0).
int dl_host_generate(const char ** roles, const char ** contents, int n_messages,
                     int max_tokens, float temperature, unsigned int seed, int think,
                     dl_token_cb cb, void * user, int * n_tokens);

// Ask a running dl_host_generate to stop after the current token. Thread-safe.
void dl_host_cancel(void);

// Message for the last error. Valid until the next call that sets it.
const char * dl_last_error(void);

#ifdef __cplusplus
}
#endif
