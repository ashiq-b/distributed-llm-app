// Per-device split facts parsed from llama.cpp's own load log. Never estimated.
#pragma once
#include <map>
#include <string>

namespace dl_stats {

struct snapshot {
    std::map<std::string, double> model_mib;   // device name (e.g. "MTL0", "RPC0") -> MiB of weights
    std::map<int, std::string>    layer_dev;   // layer index -> device name
};

void reset();                       // call before each model load
void feed(const char * text);       // feed raw log text (may contain partial lines)
snapshot get();

} // namespace dl_stats
