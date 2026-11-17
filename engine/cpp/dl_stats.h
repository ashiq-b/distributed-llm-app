// Per-device split facts parsed from llama.cpp's own load log. Never estimated.
#pragma once
#include <map>
#include <string>

namespace dl_stats {

struct snapshot {
    std::map<std::string, double> model_mib;   // buffer owner -> MiB of weights: local device name ("MTL0")
                                               // or RPC buffer key "RPC<index on server>[host:port]"
    std::map<int, std::string>    layer_dev;   // layer index -> device name
};

void reset();                       // call before each model load
void feed(const char * text);       // feed raw log text (may contain partial lines)
snapshot get();

} // namespace dl_stats
