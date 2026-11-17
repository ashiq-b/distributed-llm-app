#include "dl_engine.h"

#include "ggml-backend.h"
#include "ggml-rpc.h"

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
