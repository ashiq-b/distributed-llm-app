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
#include <cmath>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
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
    size_t             index = 0;  // device index on its RPC server
};

constexpr uint32_t       N_CTX   = 4096;
constexpr uint32_t       N_BATCH = 512;
constexpr size_t         MIN_ANSWER = 256;   // room an answer needs, in tokens

std::mutex               g_host_mu;
llama_model *            g_model = nullptr;
llama_context *          g_ctx   = nullptr;
std::atomic<bool>        g_cancel{false};
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

void set_last_error(const std::string & msg) {
    std::lock_guard<std::mutex> e(g_mu);
    g_last_error = msg;
}

void unload_locked() {
    if (g_ctx) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
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
            devs.push_back({ggml_backend_reg_dev_get(reg, d), endpoints[i], d});
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
    ggml_backend_rpc_clear_failure();
    llama_model * model = llama_model_load_from_file(model_path, params);
    if (!model) {
        std::lock_guard<std::mutex> e(g_mu);
        const bool oom = g_last_error.find("allocate") != std::string::npos;
        if (g_last_error.empty()) g_last_error = std::string("failed to load ") + model_path;
        return oom ? DL_ERR_OOM : DL_ERR_LOAD;
    }
    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx   = N_CTX;
    cparams.n_batch = N_BATCH;
    llama_context * ctx = llama_init_from_model(model, cparams);
    if (!ctx) {
        llama_model_free(model);
        std::lock_guard<std::mutex> e(g_mu);
        if (g_last_error.empty()) g_last_error = "failed to create the inference context";
        return g_last_error.find("allocate") != std::string::npos ? DL_ERR_OOM : DL_ERR_LOAD;
    }
    g_model     = model;
    g_ctx       = ctx;
    g_host_devs = std::move(devs);
    return DL_OK;
}

namespace {

// The model's chat template applied to the conversation, ending with the assistant turn.
bool format_chat(const std::vector<llama_chat_message> & msgs, std::string & out) {
    const char * tmpl = llama_model_chat_template(g_model, nullptr);
    std::vector<char> buf(4096);
    for (const char * t : {tmpl, "chatml"}) {   // fall back to ChatML if the template is not recognised
        if (!t) continue;
        int32_t n = llama_chat_apply_template(t, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
        if (n > (int32_t) buf.size()) {
            buf.resize(n);
            n = llama_chat_apply_template(t, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
        }
        if (n >= 0) {
            out.assign(buf.data(), n);
            return true;
        }
    }
    return false;
}

// What the model's own template appends to the assistant turn for thinking on or off (its
// Jinja `enable_thinking` branches). llama_chat_apply_template does not run Jinja, so we add
// it ourselves. Empty for a model with no thinking switch.
std::string think_prefill(bool think) {
    const char * t = llama_model_chat_template(g_model, nullptr);
    if (!t) return "";
    const std::string tmpl = t;
    struct known_t { const char * in_template, * on, * off; };
    static const known_t known[] = {
        {"'<think>\\n\\n</think>\\n\\n'", "<think>\n", "<think>\n\n</think>\n\n"},   // Qwen3.5
        {"\"<think></think>\"",              "<think>",   "<think></think>"},             // LFM3
    };
    for (const auto & k : known) {
        if (tmpl.find(k.in_template) != std::string::npos) return think ? k.on : k.off;
    }
    return "";
}

// The token `text` is, if the vocabulary has it as exactly one token.
bool single_token(const llama_vocab * vocab, const char * text, llama_token & out) {
    llama_token toks[2];
    if (llama_tokenize(vocab, text, (int32_t) std::strlen(text), toks, 2, false, true) != 1) return false;
    out = toks[0];
    return true;
}

bool worker_lost() {
    char ep[128] = {0};
    if (!ggml_backend_rpc_get_failure(ep, sizeof(ep))) return false;
    set_last_error(ep);
    return true;
}

struct sampler_guard {
    llama_sampler * s;
    ~sampler_guard() { llama_sampler_free(s); }
};

} // namespace

extern "C" int dl_host_generate(const char ** roles, const char ** contents, int n_messages,
                                int max_tokens, float temperature, unsigned int seed, int think,
                                dl_token_cb cb, void * user, int * n_tokens) {
    if (n_tokens) *n_tokens = 0;
    if (!roles || !contents || n_messages <= 0 || max_tokens <= 0) return DL_ERR_ARGS;
    std::lock_guard<std::mutex> lk(g_host_mu);
    if (!g_model || !g_ctx) return DL_ERR_NOT_LOADED;
    if (worker_lost()) return DL_ERR_WORKER_LOST;
    g_cancel = false;

    std::vector<llama_chat_message> msgs;
    for (int i = 0; i < n_messages; i++) msgs.push_back({roles[i], contents[i]});
    std::string prompt;
    if (!format_chat(msgs, prompt)) {
        set_last_error("cannot apply the chat template");
        return DL_ERR_ARGS;
    }
    // With thinking on, the opening tag is part of the prompt, so stream it too: the
    // caller then sees the reasoning as <think>… like any other.
    const std::string prefill = think_prefill(think);
    prompt += prefill;

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    // parse the template's special tokens; add none, BOS is handled below
    int32_t n = -llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), nullptr, 0, false, true);
    std::vector<llama_token> tokens(n);
    if (llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), tokens.data(), n, false, true) < 0) {
        set_last_error("tokenization failed");
        return DL_ERR_ARGS;
    }
    // The model's template starts with BOS, but the built-in templates leave it out.
    const llama_token bos = llama_vocab_bos(vocab);
    if (llama_vocab_get_add_bos(vocab) && bos != LLAMA_TOKEN_NULL && (tokens.empty() || tokens[0] != bos)) {
        tokens.insert(tokens.begin(), bos);
    }
    // The answer gets what the context has left after the conversation, up to max_tokens.
    const size_t n_ctx = llama_n_ctx(g_ctx);
    if (tokens.size() + MIN_ANSWER > n_ctx) {
        set_last_error("conversation is too long for the " + std::to_string(n_ctx) + "-token context; start a new chat");
        return DL_ERR_CONTEXT;
    }
    max_tokens = (int) std::min<size_t>((size_t) max_tokens, n_ctx - tokens.size());

    llama_memory_clear(llama_get_memory(g_ctx), true);

    // prompt, in batches
    for (size_t i = 0; i < tokens.size(); i += N_BATCH) {
        const int32_t len = (int32_t) std::min<size_t>(N_BATCH, tokens.size() - i);
        const int32_t rc  = llama_decode(g_ctx, llama_batch_get_one(tokens.data() + i, len));
        if (worker_lost()) return DL_ERR_WORKER_LOST;
        if (rc != 0) {
            set_last_error("llama_decode failed on the prompt (" + std::to_string(rc) + ")");
            return DL_ERR_DECODE;
        }
    }

    sampler_guard smpl{llama_sampler_chain_init(llama_sampler_chain_default_params())};
    // Some models (LFM3) reason anyway after the template's "no thinking" prefill, so with
    // thinking off the reasoning tags cannot be chosen at all.
    std::vector<llama_logit_bias> bans;
    for (const char * tag : {"<think>", "</think>"}) {
        llama_token tok;
        if (!think && single_token(vocab, tag, tok)) bans.push_back({tok, -INFINITY});
    }
    if (!bans.empty()) {
        llama_sampler_chain_add(smpl.s, llama_sampler_init_logit_bias(llama_vocab_n_tokens(vocab), (int32_t) bans.size(), bans.data()));
    }
    if (temperature <= 0.0f) {
        llama_sampler_chain_add(smpl.s, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl.s, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl.s, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(smpl.s, llama_sampler_init_dist(seed));
    }

    if (think && !prefill.empty() && cb && cb(prefill.c_str(), user) != 0) return DL_STOP_CANCELLED;

    char piece[256];
    for (int i = 0; i < max_tokens; i++) {
        llama_token tok = llama_sampler_sample(smpl.s, g_ctx, -1);
        if (worker_lost()) return DL_ERR_WORKER_LOST;
        if (llama_vocab_is_eog(vocab, tok)) return DL_STOP_EOS;

        if (n_tokens) *n_tokens = i + 1;
        const int32_t len = llama_token_to_piece(vocab, tok, piece, sizeof(piece) - 1, 0, false);
        piece[len > 0 ? len : 0] = '\0';
        if (cb && cb(piece, user) != 0) return DL_STOP_CANCELLED;
        if (g_cancel) return DL_STOP_CANCELLED;
        if (i + 1 == max_tokens) break;

        const int32_t rc = llama_decode(g_ctx, llama_batch_get_one(&tok, 1));
        if (worker_lost()) return DL_ERR_WORKER_LOST;
        if (rc != 0) {
            set_last_error("llama_decode failed (" + std::to_string(rc) + ")");
            return DL_ERR_DECODE;
        }
    }
    return DL_STOP_MAX_TOKENS;
}

extern "C" void dl_host_cancel(void) {
    g_cancel = true;
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
        // local buffers are named after the device; RPC buffers after (index on server, endpoint)
        const std::string buf_key = d.endpoint.empty()
            ? dev_name
            : "RPC" + std::to_string(d.index) + "[" + d.endpoint + "]";
        auto it = snap.model_mib.find(buf_key);
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
