# Distributed On-Device LLM — Design

Companion to [`plan.md`](../../../plan.md). The plan says *what* and *why*; this document says *how*, in enough detail to build from.

## 1. Intent

Prove that one small LLM can be **genuinely split** across ordinary consumer devices on a home network: phones and laptops, across platforms. We use llama.cpp's existing RPC backend, wrapped in an app that looks and works like a real product. The iPhone is the primary device: it must be able to **host** (run the chat and drive the split) and **work** (lend compute to another host).

## 2. Goals, non-goals, anti-goals

**Goals**
- iPhone ↔ Mac split working in both directions (P0).
- Android joining as worker and host from the same codebase (P1).
- A polished, functional UI: discovery, model library, chat, split view.
- Three current GGUF models under 3B: LFM3-1.7B, Qwen3.5-2B, Qwen3.5-0.8B.
- A static project page on Vercel (P1).

**Non-goals**
- Throughput or latency. Distributed over Wi‑Fi is expected to be slower than a single device.
- Internet or WAN operation, authentication, encryption.
- App Store / Play Store distribution.
- Windows and Linux builds in v1. Keep code portable (no macOS-only shortcuts outside platform glue) so they can follow.
- Multi-user or multi-session hosting.

**Anti-goals** (failure even if the demo "works")
- Any faked or simulated data, anywhere: canned numbers, mock devices, placeholder stats, a worker that isn't really holding tensors, or a split view not driven by llama.cpp's own data. This is a real product. Empty states are shown as empty, unknown values as "unknown".
- Spawning external processes on any platform. It doesn't work on iOS, and we want one code path everywhere.
- Patching llama.cpp's source. We pin and wrap it; we don't fork it.

## 3. Constraints

- **iOS:**
  - No child processes, so the engine must be linked into the app.
  - Background suspension.
  - Local Network permission prompt.
  - Raw multicast sockets need an entitlement that free developer accounts can't get.
  - Roughly 3 GB usable memory per app on a 6 GB iPhone.
- **Free Apple developer account:** 7-day provisioning, and no restricted entitlements.
- **llama.cpp RPC:**
  - Custom TCP protocol, not gRPC.
  - No authentication.
  - Client and server must be the same protocol version.
  - No discovery.
- **Workers don't need the model file.** The host streams tensors to them at load time (1–2 GB over Wi‑Fi). Workers can cache tensors on disk (`ggml-rpc` cache) to speed up later loads.
- **Test hardware:** an Apple-silicon Mac, an iPhone 15 (A16, 6 GB), and an intermittently available mid-range Android phone with low storage.

## 4. Approaches considered

| | Approach | Verdict |
|---|---|---|
| **A** | **Compile llama.cpp per platform, expose it through our own thin C wrapper, and call that from Rust via FFI** | **Chosen.** Only option that guarantees in-process RPC server and client on iOS, with full control of the pinned version. Cost: per-platform build setup up front. |
| B | Use a community Rust binding crate (`llama-cpp-2`) | Rejected. Unclear whether it exposes the RPC server and RPC device registration. A dead end discovered mid-build would cost more than A's setup. |
| C | Ship `rpc-server` / `llama-server` executables as sidecar processes | Rejected. iOS forbids launching processes. |

## 5. Architecture

```
┌────────────────────────── one app, every platform ──────────────────────────┐
│ UI (React + TS)        Devices · Models · Chat · Split view                 │
│        ▲ Tauri commands / events                                            │
│ Core (Rust)            role manager · discovery · downloads · chat session  │
│        ▲ FFI (C ABI)                                                        │
│ Engine wrapper (C++)   dl_worker_* · dl_host_* · dl_stats_* · log capture   │
│        ▲                                                                    │
│ llama.cpp (pinned)     libllama · ggml · ggml-metal/cpu · ggml-rpc          │
└─────────────────────────────────────────────────────────────────────────────┘
Platform glue: Swift plugin (iOS Bonjour, idle timer) · Kotlin plugin (Android multicast lock)
```

### 5.1 Engine wrapper (C ABI)

A single C++ file compiled with llama.cpp, exposing a small C API. The signatures below are the intent; exact llama.cpp calls are checked against the pinned commit.

```c
// Worker
int  dl_worker_start(const char* bind_host, int port, const char* cache_dir, int n_threads);
void dl_worker_stop(void);
int  dl_worker_status(dl_worker_status_t* out);       // running, bound endpoint, device name, free mem

// Host
int  dl_host_load(const char* model_path,
                  const char** rpc_endpoints, int n_endpoints,   // "192.168.1.20:50052"
                  const float* tensor_split /* nullable */,
                  dl_load_progress_cb cb, void* user);
int  dl_host_generate(const char* chat_json, dl_token_cb on_token, void* user);  // streams text
void dl_host_cancel(void);
void dl_host_unload(void);

// Truth for the split view
int  dl_stats_devices(dl_device_share_t* out, int max);  // per device: name, endpoint, layers, buffer MiB
void dl_set_log_cb(dl_log_cb cb, void* user);
```

- **Worker:**
  - Wraps `ggml_backend_rpc_start_server` on a dedicated thread. That call blocks, so stopping means closing the listener and joining the thread.
  - Exposes the default accelerator: Metal on Apple devices, CPU on Android.
- **Host:**
  - Mirrors what llama.cpp's `common` code does for `--rpc`: add an RPC server per endpoint, collect its devices, then pass local devices plus RPC devices in `llama_model_params.devices`.
  - Sets `n_gpu_layers` to "all", so layers land on devices rather than the host CPU.
  - Default split is llama.cpp's own (by free memory); `tensor_split` overrides it.
- **Split stats:**
  - Primary source: the per-device buffer sizes llama.cpp reports at load (`load_tensors: <device> model buffer size = … MiB`), captured via the log callback.
  - Cross-checked with `ggml_backend_dev_memory`.
  - Layer ranges come from the same load output.
  - If a value can't be obtained from llama.cpp, the UI shows "unknown". It never shows an estimate presented as fact.

### 5.2 Rust core (Tauri 2)

- **Role manager:**
  - A device is Idle, Worker, or Host.
  - Hosting also keeps the local device's own compute in the split.
  - One role at a time in v1: a host doesn't also run its worker server, which avoids self-RPC loops.
- **Discovery:**
  - Service type `_distllm._tcp`.
  - TXT record: `name`, `platform`, `app_ver`, `proto` (llama.cpp RPC protocol version), `rpc_port`, `free_mem_mb`, `role`.
  - Peers with a mismatched `proto` or `app_ver` are listed but greyed out with "incompatible version".
  - macOS and Android use the `mdns-sd` crate (Android takes a `WifiManager.MulticastLock` via a small Kotlin plugin).
  - iOS uses `NWListener` / `NWBrowser` via a Swift plugin, because raw multicast needs an entitlement free accounts can't get.
  - Manual "add by address" is always available.
- **Downloads:**
  - A fixed catalog of 2–3 models (URL, size, SHA-256, chat template notes).
  - Resumable HTTP download into the app data directory, with hash verification.
  - Only the host needs the file.
- **Chat session:**
  - Applies the model's chat template.
  - Streams tokens to the UI as Tauri events.
  - Supports cancel.
- **Errors surfaced to the UI:** worker unreachable, worker dropped mid-generation (abort with a clear message; no silent fallback to local-only), not enough memory, version mismatch.

### 5.3 UI (React)

Stack mirrors the team's existing Tauri app: React 18, TypeScript, Tailwind 3, shadcn/ui, Zustand, Motion. It's responsive: phone layout first, with the same screens laid out wider on desktop.

| Screen | Contents |
|---|---|
| **Devices** | This device: name, role toggle (Worker / Host), RPC status. Nearby devices: platform icon, free memory, status, select for hosting. Add-by-address. |
| **Models** | Catalog cards: size, parameters, download / progress / delete, "fits on this device?" hint. |
| **Chat** | Streaming conversation, model + devices in use shown in the header, stop button. |
| **Split view** | One bar per device: layer range, MiB held, live/dropped status, sourced from `dl_stats_devices`. Visible beside the chat on desktop, as a sheet on phone. |

Visual design is produced at implementation with a dedicated design pass. The bar: something you'd happily demo, not a debug panel.

### 5.4 Platform builds

| Platform | Engine build | Notes |
|---|---|---|
| macOS | CMake via Rust `build.rs` (`cmake` crate). `GGML_METAL=ON`, `GGML_METAL_EMBED_LIBRARY=ON`, `GGML_RPC=ON`, static libs | Baseline; all engine work proven here first |
| iOS | Same, cross-compiled for `aarch64-apple-ios`. Link Metal, Foundation, Accelerate | Info.plist: `NSLocalNetworkUsageDescription`, `NSBonjourServices`. Disable idle timer while active |
| Android | Same via NDK toolchain, `arm64-v8a`, CPU backend | Multicast lock; smallest model only |

Common: `LLAMA_CURL=OFF`, `BUILD_SHARED_LIBS=OFF`. llama.cpp is vendored as a git submodule at one pinned commit.

### 5.5 Project page (Vercel)

- A static site in `site/` (separate from the app), deployed to Vercel.
- Contents: overview, how it works, the recorded demo video of the real app, real screenshots, download links (macOS app, Android APK; iOS via Xcode instructions), setup steps, limitations.
- It runs no inference and shows no simulated UI, because browsers can't open the raw TCP connections llama.cpp RPC needs.
- Every asset on it is captured from the real app.

## 6. Data flow: iPhone hosts, Mac works

1. Mac: the user taps **Worker**. The wrapper starts the RPC server on `0.0.0.0:50052`, and discovery advertises `_distllm._tcp`.
2. iPhone: Devices lists the Mac (compatible, 11.2 GB free). The user selects it and switches to **Host**.
3. iPhone: the user picks a downloaded model and taps **Load**. `dl_host_load(model, ["192.168.1.20:50052"])` runs. llama.cpp assigns layers by free memory and streams the Mac's tensors over TCP.
4. Split view fills from llama.cpp's load report, e.g. "iPhone (Metal) 0–7 · 410 MiB; Mac via RPC 8–27 · 690 MiB".
5. The user chats. For each token, compute runs through the iPhone's layers, then the Mac's (via RPC), and the token streams back to the UI.

## 7. Testing

| Level | What | How |
|---|---|---|
| Engine | Worker + host on one Mac (two processes, localhost); split > 0 on the RPC device; deterministic output vs. a single-device run with the same seed | Small C++/Rust integration test |
| Core | TXT record encode/decode, version-compatibility rules, download resume + hash | `cargo test` |
| UI | Store logic, screen states (empty, loading, error, dropped worker) | Vitest + React Testing Library |
| Devices | Manual checklist per P0/P1 scenario: discover, load, chat, kill worker mid-generation, reload with cache | Run on real hardware at each milestone; results recorded in the README |

**The "real split" test:**
- The RPC device's reported buffer is > 0 MiB.
- The worker logs incoming tensor traffic.
- Killing the worker mid-generation makes generation fail. If it carried on, the worker wasn't actually doing work.

## 8. Left to the builder

- Exact llama.cpp commit to pin (latest that builds cleanly for iOS + Android with RPC).
- Confirm each catalog model (LFM3-1.7B, Qwen3.5-2B, Qwen3.5-0.8B; text-only use, no vision projector) loads and chats correctly **in split mode** at the pinned commit; replace any that fail with the next-newest model under 3B.
- Exact wrapper internals against the pinned API.
- Visual design details.
- Whether the iOS increased-memory-limit entitlement is usable with a free account. If not, the iPhone hosts the smaller models only.
