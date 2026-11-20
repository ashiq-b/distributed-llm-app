// Worker side of fast loading: serve weight tensors from this device's own copy of a model.
//
// A host loading a model sends each weight tensor over 1 MiB as a hash first (llama.cpp
// RPC, threshold set by patch 0002). If this worker has the same GGUF file, the lookup
// below finds the tensor by that hash and copies it from the file's memory map, so the
// bytes never cross the network. Tensors are indexed once per file; the index is saved
// next to the RPC cache and reused while the file's size and modification time match.

#include "dl_engine.h"

#include "ggml-rpc.h"
#include "gguf.h"

#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

// Only tensors the host asks about by hash (HASH_THRESHOLD in patch 0002).
constexpr size_t   MIN_TENSOR  = 1 * 1024 * 1024;
constexpr char     MAGIC[8]    = {'D', 'L', 'I', 'D', 'X', '0', '0', '1'};

struct entry {
    uint64_t hash;
    uint64_t offset;   // from the start of the file
    uint64_t size;
};

struct region {
    const uint8_t * data;
    size_t          size;
};

std::shared_mutex                         g_mu;
std::unordered_map<uint64_t, region>      g_regions;   // hash -> bytes in a mapped file
std::unordered_map<std::string, uint64_t> g_indexed;   // path -> tensors indexed
std::atomic<uint64_t>                     g_served{0};

bool lookup(uint64_t hash, const void ** data, size_t * size, void *) {
    std::shared_lock<std::shared_mutex> lk(g_mu);
    auto it = g_regions.find(hash);
    if (it == g_regions.end()) return false;
    *data = it->second.data;
    *size = it->second.size;
    g_served += it->second.size;
    return true;
}

struct file_id {
    uint64_t size, mtime;
};

bool read_index(const std::string & path, const file_id & id, std::vector<entry> & out) {
    std::ifstream f(path, std::ios::binary);
    char magic[8];
    file_id saved{};
    uint64_t n = 0;
    if (!f.read(magic, 8) || std::memcmp(magic, MAGIC, 8) != 0) return false;
    if (!f.read((char *) &saved, sizeof(saved)) || saved.size != id.size || saved.mtime != id.mtime) return false;
    if (!f.read((char *) &n, sizeof(n)) || n > 100000) return false;
    out.resize(n);
    return (bool) f.read((char *) out.data(), (std::streamsize) (n * sizeof(entry)));
}

void write_index(const std::string & path, const file_id & id, const std::vector<entry> & entries) {
    const std::string tmp = path + ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        const uint64_t n = entries.size();
        f.write(MAGIC, 8);
        f.write((const char *) &id, sizeof(id));
        f.write((const char *) &n, sizeof(n));
        f.write((const char *) entries.data(), (std::streamsize) (n * sizeof(entry)));
        if (!f) return;   // not saved: it is rebuilt next time
    }
    std::rename(tmp.c_str(), path.c_str());
}

std::string basename_of(const std::string & path) {
    const size_t slash = path.find_last_of('/');
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

} // namespace

extern "C" void dl_model_cache_install(void) {
    ggml_backend_rpc_set_cache_lookup(lookup, nullptr);
}

extern "C" int dl_worker_add_model(const char * gguf_path, const char * index_dir) {
    if (!gguf_path || !index_dir) return DL_ERR_ARGS;
    const std::string path = gguf_path;
    {
        std::shared_lock<std::shared_mutex> lk(g_mu);
        auto it = g_indexed.find(path);
        if (it != g_indexed.end()) return (int) it->second;
    }

    struct stat st{};
    if (stat(gguf_path, &st) != 0) return DL_ERR_LOAD;
    const file_id id{(uint64_t) st.st_size, (uint64_t) st.st_mtime};

    // Kept mapped for the life of the process (the worker can't stop either).
    const int fd = open(gguf_path, O_RDONLY);
    if (fd < 0) return DL_ERR_LOAD;
    void * map = mmap(nullptr, (size_t) st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    close(fd);
    if (map == MAP_FAILED) return DL_ERR_LOAD;
    const uint8_t * base = (const uint8_t *) map;

    const std::string index_path = std::string(index_dir) + "/" + basename_of(path) + ".dlidx";
    std::vector<entry> entries;
    if (!read_index(index_path, id, entries)) {
        gguf_init_params params{/*no_alloc =*/ true, /*ctx =*/ nullptr};
        gguf_context * ctx = gguf_init_from_file(gguf_path, params);
        if (!ctx) {
            munmap(map, (size_t) st.st_size);
            return DL_ERR_LOAD;
        }
        const size_t data = gguf_get_data_offset(ctx);
        for (int64_t i = 0; i < gguf_get_n_tensors(ctx); i++) {
            const uint64_t off  = data + gguf_get_tensor_offset(ctx, i);
            const uint64_t size = gguf_get_tensor_size(ctx, i);
            if (size <= MIN_TENSOR || off + size > (uint64_t) st.st_size) continue;
            entries.push_back({ggml_backend_rpc_hash(base + off, size), off, size});
        }
        gguf_free(ctx);
        write_index(index_path, id, entries);
    }

    std::unique_lock<std::shared_mutex> lk(g_mu);
    for (const entry & e : entries) {
        if (e.offset + e.size <= (uint64_t) st.st_size) {
            g_regions.emplace(e.hash, region{base + e.offset, (size_t) e.size});
        }
    }
    g_indexed[path] = entries.size();
    return (int) entries.size();
}

extern "C" unsigned long long dl_worker_bytes_from_models(void) {
    return g_served;
}
