#include "dl_engine.h"
#include "dl_stats.h"

#include "ggml-backend.h"
#include "ggml-rpc.h"
#include "llama.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

enum worker_state : int { IDLE = 0, STARTING = 1, RUNNING = 2, EXITED = 3 };

std::atomic<int> g_state{IDLE};
std::mutex       g_mu;            // guards the strings below
std::string      g_endpoint;
std::string      g_device;
ggml_backend_dev_t g_dev = nullptr;

// Same rule as llama.cpp's rpc-server: every non-CPU, non-ACCEL device; else the CPU.
std::vector<ggml_backend_dev_t> default_devices() {
    std::vector<ggml_backend_dev_t> devs;
    for (size_t i = 0; i < ggml_backend_dev_count(); i++) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        enum ggml_backend_dev_type t = ggml_backend_dev_type(dev);
        if (t != GGML_BACKEND_DEVICE_TYPE_CPU && t != GGML_BACKEND_DEVICE_TYPE_ACCEL) {
            devs.push_back(dev);
        }
    }
    if (devs.empty()) {
        if (ggml_backend_dev_t cpu = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU)) {
            devs.push_back(cpu);
        }
    }
    return devs;
}

long long free_mib(ggml_backend_dev_t dev) {
    if (!dev) return -1;
    size_t free = 0, total = 0;
    ggml_backend_dev_memory(dev, &free, &total);
    return total == 0 ? -1 : (long long)(free / (1024 * 1024));
}

bool parse_ipv4(const char * host, int port, sockaddr_in & addr) {
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port   = htons((uint16_t)port);
    return inet_pton(AF_INET, host, &addr.sin_addr) == 1;
}

// Can we bind host:port right now? (The server itself reports bind failures
// only to its log, so we check first to return a real error.)
bool can_bind(const char * host, int port) {
    sockaddr_in addr;
    if (!parse_ipv4(host, port, addr)) return false;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    bool ok = bind(fd, (sockaddr *)&addr, sizeof(addr)) == 0;
    close(fd);
    return ok;
}

bool can_connect(const char * host, int port) {
    sockaddr_in addr;
    if (!parse_ipv4(host, port, addr)) return false;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    bool ok = connect(fd, (sockaddr *)&addr, sizeof(addr)) == 0;
    close(fd);
    return ok;
}

} // namespace

extern "C" int dl_worker_start(const char * bind_host, int port, const char * cache_dir, int n_threads) {
    if (!bind_host || port <= 0 || port > 65535) return DL_ERR_ARGS;

    int expected = IDLE;
    if (!g_state.compare_exchange_strong(expected, STARTING)) {
        return expected == EXITED ? DL_ERR_START : DL_ERR_ALREADY_RUNNING;
    }
    auto fail = [](int rc) { g_state = IDLE; return rc; };

    if (!can_bind(bind_host, port)) return fail(DL_ERR_BIND);

    std::vector<ggml_backend_dev_t> devs = default_devices();
    if (devs.empty()) return fail(DL_ERR_NO_DEVICE);

    const std::string endpoint = std::string(bind_host) + ":" + std::to_string(port);
    const std::string cache    = cache_dir ? cache_dir : "";
    size_t threads = n_threads > 0 ? (size_t)n_threads
                                   : std::max<size_t>(1, std::thread::hardware_concurrency() / 2);
    {
        std::lock_guard<std::mutex> lk(g_mu);
        g_endpoint = endpoint;
        g_dev      = devs[0];
        g_device   = ggml_backend_dev_description(devs[0]);
    }

    std::thread([endpoint, cache, threads, devs]() mutable {
        ggml_backend_rpc_start_server(endpoint.c_str(), cache.empty() ? nullptr : cache.c_str(),
                                      threads, devs.size(), devs.data());
        g_state = EXITED;   // only reached if the server failed or stopped
    }).detach();

    // Wait until it is accepting connections (or has given up).
    const std::string probe_host = std::strcmp(bind_host, "0.0.0.0") == 0 ? "127.0.0.1" : bind_host;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (std::chrono::steady_clock::now() < deadline) {
        if (g_state == EXITED) return DL_ERR_START;
        if (can_connect(probe_host.c_str(), port)) {
            int starting = STARTING;
            g_state.compare_exchange_strong(starting, RUNNING);
            return g_state == RUNNING ? DL_OK : DL_ERR_START;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    return DL_ERR_START;
}

extern "C" int dl_worker_status(dl_worker_status_t * out) {
    if (!out) return DL_ERR_ARGS;
    std::memset(out, 0, sizeof(*out));
    out->running = g_state == RUNNING ? 1 : 0;
    std::lock_guard<std::mutex> lk(g_mu);
    std::snprintf(out->endpoint, sizeof(out->endpoint), "%s", g_endpoint.c_str());
    std::snprintf(out->device, sizeof(out->device), "%s", g_device.c_str());
    out->free_mb = free_mib(g_dev);
    return DL_OK;
}

extern "C" const char * dl_rpc_proto_version(void) {
#define DL_STR2(x) #x
#define DL_STR(x) DL_STR2(x)
    return DL_STR(RPC_PROTO_MAJOR_VERSION) "." DL_STR(RPC_PROTO_MINOR_VERSION) "." DL_STR(RPC_PROTO_PATCH_VERSION);
}

extern "C" long long dl_device_free_mb(void) {
    std::vector<ggml_backend_dev_t> devs = default_devices();
    return devs.empty() ? -1 : free_mib(devs[0]);
}

// ---- Host -------------------------------------------------------------------

namespace {

struct host_device {
    ggml_backend_dev_t dev;
    std::string        endpoint;   // empty for local devices
};

std::mutex               g_host_mu;
llama_model *            g_model = nullptr;
std::vector<host_device> g_host_devs;
std::string              g_last_error;

void log_cb(enum ggml_log_level level, const char * text, void * /*user*/) {
    dl_stats::feed(text);
    if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) {
        std::fputs(text, stderr);
        if (level == GGML_LOG_LEVEL_ERROR) {
            std::lock_guard<std::mutex> lk(g_mu);
            g_last_error += text;
        }
    }
}

void ensure_backend() {
    static std::once_flag once;
    std::call_once(once, [] {
        llama_log_set(log_cb, nullptr);
        llama_backend_init();
    });
}

struct progress_ctx { dl_progress_cb cb; void * user; };

bool progress_trampoline(float frac, void * user) {
    auto * p = static_cast<progress_ctx *>(user);
    if (p->cb) p->cb(frac, p->user);
    return true;
}

void unload_locked() {
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    g_host_devs.clear();
}

} // namespace

extern "C" int dl_host_load(const char * model_path, const char ** endpoints, int n_endpoints,
                            const float * tensor_split, dl_progress_cb cb, void * user) {
    if (!model_path || n_endpoints < 0 || (n_endpoints > 0 && !endpoints)) return DL_ERR_ARGS;
    ensure_backend();

    std::lock_guard<std::mutex> lk(g_host_mu);
    unload_locked();
    { std::lock_guard<std::mutex> e(g_mu); g_last_error.clear(); }

    // Same order as llama.cpp's default device selection: RPC servers first, local GPUs last
    // (so the host keeps the output layer).
    std::vector<host_device> devs;
    for (int i = 0; i < n_endpoints; i++) {
        ggml_backend_reg_t reg = ggml_backend_rpc_add_server(endpoints[i]);
        if (!reg) {
            std::lock_guard<std::mutex> e(g_mu);
            g_last_error = std::string("cannot add RPC server ") + endpoints[i];
            return DL_ERR_LOAD;
        }
        for (size_t d = 0; d < ggml_backend_reg_dev_count(reg); d++) {
            devs.push_back({ggml_backend_reg_dev_get(reg, d), endpoints[i]});
        }
    }
    for (ggml_backend_dev_t dev : default_devices()) {
        if (ggml_backend_dev_type(dev) != GGML_BACKEND_DEVICE_TYPE_CPU) devs.push_back({dev, ""});
    }

    std::vector<ggml_backend_dev_t> dev_list;
    for (auto & d : devs) dev_list.push_back(d.dev);
    dev_list.push_back(nullptr);

    progress_ctx pctx{cb, user};
    llama_model_params params = llama_model_default_params();
    params.devices                     = dev_list.data();
    params.n_gpu_layers                = 999;
    params.split_mode                  = LLAMA_SPLIT_MODE_LAYER;
    params.tensor_split                = tensor_split;
    params.progress_callback           = progress_trampoline;
    params.progress_callback_user_data = &pctx;

    dl_stats::reset();
    llama_model * model = llama_model_load_from_file(model_path, params);
    if (!model) {
        std::lock_guard<std::mutex> e(g_mu);
        const bool oom = g_last_error.find("allocate") != std::string::npos;
        if (g_last_error.empty()) g_last_error = std::string("failed to load ") + model_path;
        return oom ? DL_ERR_OOM : DL_ERR_LOAD;
    }
    g_model     = model;
    g_host_devs = std::move(devs);
    return DL_OK;
}

extern "C" int dl_stats_devices(dl_device_share_t * out, int max) {
    if (!out || max <= 0) return 0;
    std::lock_guard<std::mutex> lk(g_host_mu);
    if (!g_model) return 0;
    const dl_stats::snapshot snap = dl_stats::get();

    int n = 0;
    for (const auto & d : g_host_devs) {
        if (n >= max) break;
        dl_device_share_t & s = out[n++];
        std::memset(&s, 0, sizeof(s));
        const std::string dev_name = ggml_backend_dev_name(d.dev);
        std::snprintf(s.name, sizeof(s.name), "%s", ggml_backend_dev_description(d.dev));
        std::snprintf(s.endpoint, sizeof(s.endpoint), "%s", d.endpoint.c_str());
        s.is_remote   = d.endpoint.empty() ? 0 : 1;
        s.layer_first = -1;
        s.layer_last  = -1;
        for (const auto & [layer, name] : snap.layer_dev) {
            if (name != dev_name) continue;
            if (s.layer_first < 0 || layer < s.layer_first) s.layer_first = layer;
            if (layer > s.layer_last) s.layer_last = layer;
        }
        auto it = snap.model_mib.find(dev_name);
        s.buffer_mib = it == snap.model_mib.end() ? -1.0 : it->second;
    }
    return n;
}

extern "C" void dl_host_unload(void) {
    std::lock_guard<std::mutex> lk(g_host_mu);
    unload_locked();
}

extern "C" const char * dl_last_error(void) {
    static thread_local std::string copy;
    std::lock_guard<std::mutex> lk(g_mu);
    copy = g_last_error;
    return copy.c_str();
}
