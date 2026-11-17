#include "dl_stats.h"

#include <cstdio>
#include <cstring>
#include <mutex>

namespace dl_stats {
namespace {

std::mutex  g_mu;
std::string g_partial;
snapshot    g_snap;

// "MTL0_Mapped" -> "MTL0", "CPU" -> "CPU". RPC buffer names are kept whole
// ("RPC0[127.0.0.1:50052]"): their number is the device index on that server,
// not the process-wide RPC device name, so the endpoint is needed to match them.
std::string device_of_buffer(std::string name) {
    if (name.find('[') != std::string::npos) return name;
    if (auto p = name.find("_Mapped"); p != std::string::npos) name.resize(p);
    return name;
}

void parse_line(const std::string & line) {
    // load_tensors: layer  12 assigned to device RPC0, is_swa = 0
    if (auto p = line.find("load_tensors: layer "); p != std::string::npos) {
        int  layer = -1;
        char dev[64] = {0};
        if (std::sscanf(line.c_str() + p, "load_tensors: layer %d assigned to device %63[^,]", &layer, dev) == 2) {
            g_snap.layer_dev[layer] = dev;
        }
        return;
    }
    // load_tensors:  MTL0_Mapped model buffer size =   231.14 MiB
    const char * marker = " model buffer size = ";
    if (line.find("load_tensors:") != std::string::npos) {
        auto m = line.find(marker);
        if (m == std::string::npos) return;
        auto start = line.find(':') + 1;
        std::string name = line.substr(start, m - start);
        name.erase(0, name.find_first_not_of(' '));
        double mib = 0;
        if (std::sscanf(line.c_str() + m + std::strlen(marker), "%lf", &mib) == 1) {
            g_snap.model_mib[device_of_buffer(name)] += mib;
        }
    }
}

} // namespace

void reset() {
    std::lock_guard<std::mutex> lk(g_mu);
    g_partial.clear();
    g_snap = snapshot{};
}

void feed(const char * text) {
    if (!text) return;
    std::lock_guard<std::mutex> lk(g_mu);
    g_partial += text;
    size_t nl;
    while ((nl = g_partial.find('\n')) != std::string::npos) {
        parse_line(g_partial.substr(0, nl));
        g_partial.erase(0, nl + 1);
    }
}

snapshot get() {
    std::lock_guard<std::mutex> lk(g_mu);
    return g_snap;
}

} // namespace dl_stats
