# Patches to the pinned llama.cpp

llama.cpp stays pinned (see `engine/LLAMA_CPP_VERSION`). These small patches are applied
on top by `scripts/apply-llama-patches.sh`, which `engine/build.rs` and
`scripts/build-llama-cli.sh` run automatically. Every patched line is marked `[distllm patch]`.

| Patch | Why |
|---|---|
| `0001-rpc-report-lost-server-instead-of-abort.patch` | In v1.0.0, a lost RPC server makes the host **abort the whole process** (`RPC_STATUS_ASSERT` in `rpc_dispatcher::work`). The patch records the failure (`ggml_backend_rpc_get_failure` / `ggml_backend_rpc_clear_failure`), completes pending messages without sending, and never reuses a failed connection. It also enables TCP keepalive on client sockets so a peer that vanishes without closing (Wi‑Fi drop) is detected in ~11 s instead of blocking forever. The app reports "worker lost" and stays running. |

To refresh a patch after editing the submodule: `git -C engine/llama.cpp diff > patches/llama.cpp/<name>.patch`.
