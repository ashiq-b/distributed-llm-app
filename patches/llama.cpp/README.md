# Patches to the pinned llama.cpp

llama.cpp stays pinned (see `engine/LLAMA_CPP_VERSION`). These small patches are applied
on top by `scripts/apply-llama-patches.sh`, which `engine/build.rs` and
`scripts/build-llama-cli.sh` run automatically. Every patched line is marked `[distllm patch]`.

| Patch | Why |
|---|---|
| `0001-rpc-report-lost-server-instead-of-abort.patch` | In v1.0.0, a lost RPC server makes the host **abort the whole process** (`RPC_STATUS_ASSERT` in `rpc_dispatcher::work`). The patch records the failure (`ggml_backend_rpc_get_failure` / `ggml_backend_rpc_clear_failure`), completes pending messages without sending, and never reuses a failed connection. It also enables TCP keepalive on client sockets so a peer that vanishes without closing (Wi‑Fi drop) is detected in ~11 s instead of blocking forever. The app reports "worker lost" and stays running. |
| `0002-rpc-weight-cache-lookup-and-upload-stats.patch` | Loading over Wi‑Fi re-sent most of the worker's weights every time: llama.cpp only checks its worker cache by hash for tensors over 10 MiB, and in our models 66–99% of the bytes are in smaller tensors. The patch lowers that to 1 MiB, adds a server-side lookup hook (`ggml_backend_rpc_set_cache_lookup`) so a worker can serve weights straight from its own copy of the model file, exposes the hash (`ggml_backend_rpc_hash`), and counts weight bytes sent vs. already on the worker (`ggml_backend_rpc_get_upload_stats`). The RPC protocol is unchanged. |
| `0003-cpu-report-available-memory-on-linux.patch` | On Linux and Android the CPU backend reports **all of RAM as free** ("ill-defined, assume all of it is free"). A phone's free memory is far less, so the app would show a false number and the host would size Android's share of the split from it. The patch reads `MemAvailable` from `/proc/meminfo` (what can be used without swapping), the same figure Android's own memory tools show. macOS and iOS use Metal's figure and are unaffected. |

To refresh the last patch after editing the submodule: stage the earlier patches' state (`git -C engine/llama.cpp add -A` before editing), then `git -C engine/llama.cpp diff > patches/llama.cpp/<name>.patch` and `git -C engine/llama.cpp reset`. The apply script rebuilds the patched files from the pinned commit plus the whole stack, so later patches may touch lines next to earlier ones.
