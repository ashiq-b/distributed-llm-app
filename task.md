# Distributed On-Device LLM — Task List

> **This is the working source of truth for development.** Work top to bottom. Each task is one commit.
> When a task is finished and verified: tick its box (`- [ ]` → `- [x]`), commit, push.
> Agentic workers: use superpowers:executing-plans (or subagent-driven-development) to run this task by task.

**Goal:** One Tauri 2 app (iOS, macOS, Android) in which any device can host a chat while others lend compute. A single small GGUF model is genuinely split across devices via llama.cpp's built-in RPC.

**Architecture:**
- llama.cpp is pinned as a git submodule and compiled into every app with `GGML_RPC=ON` (Metal on Apple, CPU on Android).
- A thin C++ wrapper (`engine/cpp`) exposes worker/host/stats functions. A Rust crate (`engine`) wraps it safely.
- The Tauri app (`app/`) calls that crate and renders a React UI.
- Discovery is Bonjour/mDNS: the `mdns-sd` crate on macOS/Android, and a Swift plugin on iOS.
- A separate static project page (`site/`) is deployed to Vercel.

**Tech stack:**
- llama.cpp / ggml (pinned)
- C++17, CMake
- Rust (stable), Tauri 2.x
- React 18, TypeScript 5, Vite 5, Tailwind CSS 3.x, shadcn/ui via `shadcn@2` CLI (not 4.x), Zustand, Motion
- Vitest
- `mdns-sd`, `reqwest`, `sha2`, `sysinfo`
- Swift (iOS plugin), Kotlin (Android plugin)

**Spec:** [`plan.md`](plan.md) (what and why) · [`docs/superpowers/specs/2026-11-16-distributed-llm-design.md`](docs/superpowers/specs/2026-11-16-distributed-llm-design.md) (how). Read both before starting any task.

---

## How we work

1. **One task = one commit.** Do the steps in order. Don't start the next task until the current one is verified.
2. **Verify for real.** "Done" means the verification step's command or device check passed and its output was seen. Paste the key output into the commit body or into `docs/evidence/`.
3. **Mark it done and push:**
   ```bash
   # tick the task's checkbox in task.md, then:
   git add -A && git commit -m "<type>: <summary>"   # body ends with the Co-Authored-By line
   scripts/push.sh                                    # pushes as the repo account
   ```
4. **Commit types:** `feat`, `fix`, `build`, `test`, `docs`, `chore`.
5. **Evidence:** device runs, logs and screenshots go in `docs/evidence/<task-id>-<short-name>.md`. Large binaries are not committed.
6. **Decision points** (marked ⚠️) stop work until the decision is recorded in the task, with the user's agreement where noted.
7. **Learning notes:** after each phase, add a beginner-friendly note to `learn/` (local only, git-ignored) explaining what was built and why.
8. **Priorities:** P0 tasks come first. P1 tasks (Android, project page) may be cut, never faked.

## Global constraints

- **Real data only.** No mock devices, placeholder numbers, sample chats or simulated results anywhere in the app or on the project page. Unknown values render as `unknown`; empty states stay empty. Tests may use fixtures; product code may not.
- **Never fake distribution.** Split numbers come only from llama.cpp (load log and backend device APIs).
- **Don't patch llama.cpp source.** Pin and wrap it. Any exception is a ⚠️ decision that needs the user's approval.
- **No child processes in the app**, on any platform. The engine runs in-process.
- **One pinned llama.cpp commit** for all platforms. It's recorded in `engine/LLAMA_CPP_VERSION`.
- **Ports and names:**
  - RPC port default `50052`
  - mDNS service type `_distllm._tcp`
  - TXT keys: `name`, `platform`, `app_ver`, `proto`, `rpc_port`, `free_mem_mb`, `role`
- **Models (catalog):** LFM3-1.7B, Qwen3.5-2B, Qwen3.5-0.8B (text-only use, GGUF, ~4-bit). Any model failing the split test is replaced by the next-newest model under 3B.
- **One role at a time per device:** Idle, Worker or Host.
- **UI:** neutral, well-matched palette with light and dark themes, no brand colours. Phone layout first, desktop wider.
- **Portability:** no macOS-only code outside platform glue, so Windows and Linux can be added later.
- **Security:** trusted LAN only. Not hidden; stated in the README and the UI's About sheet.

## Review focus

These failure modes aren't covered by the happy path. Each has a test in the task named.

1. **Worker disappears mid-generation** (app quit, Wi‑Fi drop). The host must end with a clear "worker lost" error, never hang. ggml-rpc may `abort()` on a socket error, in which case see the ⚠️ in Task 1.3 → *tests in 1.3*.
2. **Version mismatch between devices** (different app or llama.cpp builds). The peer shows as incompatible and loading with it is refused before any connection → *tests in 3.1*.
3. **Model doesn't fit** (the iPhone's ~3 GB app budget, or a low-RAM Android). This must be refused before load with a clear message, not an OS out-of-memory kill → *tests in 3.4*.
4. **Stale peers** (device sleeps, IP changes). Peers expire from the list. Connecting to a dead endpoint fails within 5 s → *tests in 3.2, 3.4*.
5. **Interrupted or corrupt download** (network loss, disk full). The download resumes, a hash mismatch deletes the file and reports an error, and a partial file is never offered as "downloaded" → *tests in 2.3*.

## File structure

```
distributed-llm-app/
├── plan.md · task.md · README.md
├── scripts/
│   ├── push.sh                    git push as the repo account
│   ├── build-llama-cli.sh         macOS CLI tools (ggml-rpc-server, llama-cli) for spikes/tests
│   └── fetch-model.sh             download a catalog model + verify SHA-256
├── engine/                        Rust crate `dl-engine` (safe API over the C wrapper)
│   ├── LLAMA_CPP_VERSION          pinned commit hash
│   ├── llama.cpp/                 git submodule (pinned)
│   ├── cpp/
│   │   ├── CMakeLists.txt         builds llama.cpp + wrapper as static libs
│   │   ├── dl_engine.h            C ABI
│   │   ├── dl_engine.cpp          worker / host / generate
│   │   └── dl_stats.cpp           load-log capture → per-device shares
│   ├── build.rs                   cmake per target (macOS / iOS / Android)
│   ├── src/{lib.rs, ffi.rs, host.rs, worker.rs, stats.rs}
│   └── tests/{worker.rs, split.rs, generate.rs}
├── app/                           Tauri 2 app
│   ├── src/                       React UI
│   │   ├── app/  (shell, routes, theme)   features/{devices,models,chat,split}/
│   │   └── lib/  (tauri bindings, stores)
│   └── src-tauri/
│       ├── src/{lib.rs, commands.rs, roles.rs, chat.rs, device_info.rs}
│       ├── src/discovery/{mod.rs, txt.rs, mdns.rs}
│       ├── src/models/{catalog.rs, catalog.json, download.rs}
│       └── plugins/
│           ├── bonjour-ios/       Swift: NWListener/NWBrowser, idle timer
│           └── multicast-android/ Kotlin: WifiManager.MulticastLock
├── site/                          static project page (Vercel)
└── docs/
    ├── superpowers/specs/…        design
    ├── evidence/                  per-task proof (logs, screenshots)
    └── test-checklist.md          device test matrix + results
```

---

## Phase 0 — Foundations and proof on the command line

Goal: prove the core claim (a real split with llama.cpp RPC, using our three models) before writing any app code.

### - [ ] Task 0.1 — Pin llama.cpp and build the CLI tools on macOS

**Files:**
- Create: `engine/llama.cpp` (submodule), `engine/LLAMA_CPP_VERSION`, `scripts/build-llama-cli.sh`
- Modify: `.gitignore` (add `engine/build*/`)

**Produces:**
- `engine/build-cli/bin/ggml-rpc-server` and `engine/build-cli/bin/llama-cli`, used by later tests.

- [ ] Add llama.cpp as a submodule at the latest release tag that builds cleanly. Write the full commit hash to `engine/LLAMA_CPP_VERSION`.
- [ ] `scripts/build-llama-cli.sh`: `cmake -S engine/llama.cpp -B engine/build-cli -DGGML_RPC=ON -DGGML_METAL=ON -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release && cmake --build engine/build-cli -j`.
- [ ] **Verify:**
  - `engine/build-cli/bin/ggml-rpc-server --help` lists `--host`, `--port` and `--cache`.
  - `llama-cli --help` lists `--rpc`.
  - The RPC server startup banner prints its protocol version. Record it in `LLAMA_CPP_VERSION`.
- [ ] **Commit:** `build: pin llama.cpp and add macOS CLI build script`. Tick the box and push.

### - [ ] Task 0.2 — Model catalog check: real split on the command line

**Files:**
- Create: `scripts/fetch-model.sh`, `app/src-tauri/src/models/catalog.json`, `docs/evidence/0.2-cli-split.md`

**Produces:** `catalog.json`, the single source for model metadata:
```json
[{ "id": "lfm3-1.7b", "name": "LFM3 1.7B", "vendor": "Liquid AI", "params_b": 1.7,
   "url": "https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/main/<file>.gguf",
   "file": "<file>.gguf", "size_bytes": 0, "sha256": "<hex>", "min_free_mb": 0 }]
```
- One entry each for `lfm3-1.7b`, `qwen3.5-2b` and `qwen3.5-0.8b`.
- Exact file names, `size_bytes` and `sha256` come from the Hugging Face repo file listing.
- Use Q4_0 or Q4_K_M; for 0.8B, Q8_0 is acceptable if it's under 1 GB.
- `min_free_mb` is measured: the host's peak RSS during the single-device run below, rounded up to 100 MB.

- [ ] `scripts/fetch-model.sh <id>`: reads `catalog.json`, downloads into `models/`, and verifies SHA-256. A mismatch deletes the file and exits with status 1.
- [ ] For each model, run a single-device baseline first: `llama-cli -m models/<file> -ngl 99 -no-cnv -p "The capital of France is" -n 16 --temp 0 --seed 1`.
- [ ] Then run the split: start `ggml-rpc-server -H 127.0.0.1 -p 50052` in one terminal, and in another run the same command plus `--rpc 127.0.0.1:50052`.
- [ ] **Verify per model, all recorded in `docs/evidence/0.2-cli-split.md`:**
  - The load log shows an `RPC[127.0.0.1:50052]` buffer greater than 0 MiB.
  - The output is coherent. Note if the greedy output differs from the baseline.
  - Killing `ggml-rpc-server` mid-generation: does the client error out or abort? Record exactly what happens. This feeds Task 1.3's ⚠️.
- [ ] ⚠️ **Decision point:** if a model fails to split or produces garbage, replace it with the next-newest model under 3B. Record why.
- [ ] **Commit:** `test: verify catalog models split over llama.cpp RPC on the CLI`. Tick the box and push.

---

## Phase 1 — Engine wrapper on macOS (P0)

Goal: the C wrapper and Rust crate do everything the app needs, proven by `cargo test` against a real `ggml-rpc-server`.

### - [ ] Task 1.1 — Engine crate skeleton and worker mode

**Files:**
- Create: `engine/Cargo.toml`, `engine/build.rs`, `engine/cpp/CMakeLists.txt`, `engine/cpp/dl_engine.h`, `engine/cpp/dl_engine.cpp`, `engine/src/{lib.rs,ffi.rs,worker.rs}`, `engine/tests/worker.rs`

**Produces (C ABI):**
```c
typedef struct { int running; char endpoint[64]; char device[64]; long long free_mb; } dl_worker_status_t;
int  dl_worker_start(const char* bind_host, int port, const char* cache_dir, int n_threads); // 0 ok, <0 error
int  dl_worker_status(dl_worker_status_t* out);
const char* dl_rpc_proto_version(void);   // e.g. "3.0.0"
long long   dl_device_free_mb(void);       // free memory of the default accelerator, -1 if unknown
```

**Produces (Rust):**
- `dl_engine::Worker::start(WorkerConfig { bind_host: String, port: u16, cache_dir: Option<PathBuf>, threads: Option<u32> }) -> Result<Worker, EngineError>`
- `Worker::status(&self) -> WorkerStatus`
- `dl_engine::rpc_proto_version() -> String`
- `dl_engine::device_free_mb() -> Option<u64>`

Details:
- `build.rs` uses the `cmake` crate on `engine/cpp`, which does `add_subdirectory(../llama.cpp)` with `GGML_RPC=ON`, `BUILD_SHARED_LIBS=OFF`, `LLAMA_CURL=OFF`, and `GGML_METAL=ON` + `GGML_METAL_EMBED_LIBRARY=ON` on Apple. It links the static libs, plus the Metal, Foundation and Accelerate frameworks on Apple.
- `dl_worker_start` runs `ggml_backend_rpc_start_server` (signature as of the pinned commit) on a detached `std::thread`, after binding succeeds.

Steps:
- [ ] **Write the failing test** `engine/tests/worker.rs::worker_accepts_tcp`: start a worker on `127.0.0.1:<free port>`, then assert that `TcpStream::connect` succeeds within 2 s and `status().running == true`.
- [ ] **Write the failing test** `worker_rejects_port_in_use`: bind a `TcpListener` to the port first, then assert that `Worker::start` returns `Err(EngineError::Bind(_))`.
- [ ] Run `cargo test -p dl-engine --test worker` and confirm it fails.
- [ ] Implement the code above.
- [ ] ⚠️ **Decision point (stopping):** if the pinned API has no way to stop the server, then `Worker` has no `stop`. The worker lives until the app quits, and the UI says so honestly ("Worker stays on until the app is closed"). Record what you find in the commit body.
- [ ] Run the tests again and confirm they pass.
- [ ] **Commit:** `feat(engine): build llama.cpp in-process and add worker mode`. Tick the box and push.

### - [ ] Task 1.2 — Host mode: load split across RPC devices, plus real stats

**Files:**
- Create: `engine/cpp/dl_stats.cpp`, `engine/src/{host.rs,stats.rs}`, `engine/tests/split.rs`
- Modify: `engine/cpp/dl_engine.{h,cpp}`, `engine/src/lib.rs`

**Produces (C ABI):**
```c
typedef void (*dl_progress_cb)(float frac, void* user);
typedef struct { char name[64]; char endpoint[64]; int is_remote; int layer_first; int layer_last; double buffer_mib; } dl_device_share_t;
int  dl_host_load(const char* model_path, const char** endpoints, int n_endpoints,
                  const float* tensor_split /*nullable*/, dl_progress_cb cb, void* user);
int  dl_stats_devices(dl_device_share_t* out, int max);   // returns count
void dl_host_unload(void);
```
- `layer_first`/`layer_last` are -1 when unknown, and `buffer_mib` is < 0 when unknown.

**Produces (Rust):**
- `dl_engine::Host::load(model: &Path, endpoints: &[String], split: Option<&[f32]>, on_progress: impl FnMut(f32)) -> Result<Host, EngineError>`
- `Host::device_shares(&self) -> Vec<DeviceShare>`
- `DeviceShare { name: String, endpoint: Option<String>, is_remote: bool, layers: Option<(u32,u32)>, buffer_mib: Option<f64> }`
- `EngineError` gains `Connect(String)`, `Load(String)`, `OutOfMemory`.

Details:
- Host load mirrors what llama.cpp's `common` does for `--rpc`: for each endpoint, add the RPC server and collect its devices; then build `llama_model_params.devices` (local GPU device first, then RPC devices, null-terminated) and set `n_gpu_layers = 999`.
- Before loading, do a TCP connect check on each endpoint with a 5 s timeout. A failure returns `Connect(endpoint)`.
- Stats: `llama_log_set` captures the load log. `dl_stats.cpp` parses `model buffer size` lines per device, and the layer assignment lines if the pinned commit prints them. Anything not printed stays unknown. Never estimate.

Steps:
- [ ] **Write the failing test** `engine/tests/split.rs::split_puts_tensors_on_rpc_device`. It's skipped unless `DL_TEST_MODEL` is set:
  - spawn `engine/build-cli/bin/ggml-rpc-server -H 127.0.0.1 -p <port>`
  - `Host::load(model, ["127.0.0.1:<port>"])`
  - assert there are exactly 2 shares, exactly 1 has `is_remote`, and the remote share's `buffer_mib.unwrap() > 0.0`
- [ ] **Write the failing test** `load_fails_fast_on_dead_endpoint`: load with `127.0.0.1:1` and assert `Err(Connect(_))` in under 6 s.
- [ ] Run `DL_TEST_MODEL=models/<qwen3.5-0.8b file> cargo test -p dl-engine --test split` and confirm it fails.
- [ ] Implement the code above.
- [ ] Run the tests again and confirm they pass. Also run with the LFM3 and Qwen3.5-2B files.
- [ ] **Commit:** `feat(engine): host mode loads model split across RPC workers with real per-device stats`. Tick the box and push.

### - [ ] Task 1.3 — Generation: chat template, streaming, cancel, worker loss

**Files:**
- Create: `engine/tests/generate.rs`
- Modify: `engine/cpp/dl_engine.{h,cpp}`, `engine/src/host.rs`

**Produces (C ABI):**
```c
typedef int (*dl_token_cb)(const char* piece, void* user);   // return 0 to continue, 1 to stop
int  dl_host_generate(const char* messages_json, int max_tokens, float temperature, int seed,
                      dl_token_cb cb, void* user);           // 0 done, 1 cancelled, <0 error
void dl_host_cancel(void);
```
- `messages_json` is `[{"role":"system|user|assistant","content":"..."}]`.

**Produces (Rust):**
- `Host::generate(&self, messages: &[ChatMessage], params: GenParams, on_token: impl FnMut(&str) -> ControlFlow<()>) -> Result<GenSummary, EngineError>`
- `ChatMessage { role: ChatRole, content: String }`, where `ChatRole` is one of `System`, `User`, `Assistant`
- `GenParams { max_tokens: u32 /*default 512*/, temperature: f32 /*0.7*/, seed: u32 }`
- `GenSummary { tokens: u32, millis: u64, stopped: StopReason }`, where `StopReason` is one of `Eos`, `MaxTokens`, `Cancelled`
- `Host::cancel(&self)`
- `EngineError::WorkerLost(String)`

Details:
- Apply the model's chat template via `llama_chat_apply_template`.
- Use a sampler chain of temperature plus top-p 0.95, or greedy when temperature is 0.
- Feed the KV cache incrementally. Reset it per call in v1, since the conversation is re-sent each time.

Steps:
- [ ] **Write the failing test** `split_greedy_matches_single_device`: generate 16 tokens with temperature 0 and seed 1, once with no endpoints and once split across a spawned `ggml-rpc-server`, then assert the two strings are equal.
  - If 0.2's evidence showed backend numeric drift, assert instead that both are non-empty and coherent, and document why.
- [ ] **Write the failing test** `cancel_stops_generation`: cancel after 3 tokens and assert `stopped == Cancelled`.
- [ ] **Write the failing test** `worker_loss_returns_error`: kill the spawned `ggml-rpc-server` after the first token, then assert that `generate` returns `Err(WorkerLost(_))` within 10 s and the test process is still alive.
- [ ] Run the tests and confirm they fail.
- [ ] Implement the code above.
- [ ] ⚠️ **Decision point (worker loss):** if ggml-rpc `abort()`s the host process on a socket error (the test process dies), we can't patch llama.cpp without the user's approval. Present the options to the user:
  - (a) Accept the crash. On relaunch, the app shows "Last session ended: worker <name> disconnected", detected from a crash marker file written before generation.
  - (b) A minimal, documented patch to ggml-rpc that turns the abort into an error return.
  - Implement whichever they choose. Then adjust the test to match: (a) asserts the marker file, (b) asserts `WorkerLost`.
- [ ] Run the tests again and confirm they pass.
- [ ] **Commit:** `feat(engine): streaming chat generation with cancel and worker-loss handling`. Tick the box and push.

---

## Phase 2 — Tauri app and the iPhone proof (P0, highest risk)

Goal: a plain but real app on Mac and iPhone that splits a model in both directions. The full UI comes in Phase 4.

### - [ ] Task 2.1 — Scaffold the Tauri app with engine commands (macOS)

**Files:**
- Create: `app/` via `npm create tauri-app` (React + TS + Vite), `app/src-tauri/src/{commands.rs,device_info.rs}`, `app/src/lib/tauri.ts`, `app/src/App.tsx` (temporary plain screen)
- Modify: the root `Cargo.toml` workspace (`engine`, `app/src-tauri`)

**Produces:**
- Rust package name `distllm-app` (`app/src-tauri/Cargo.toml`)
- Tauri commands, all returning `Result<T, String>`:
  - `worker_start(port: u16) -> WorkerStatus`
  - `worker_status() -> Option<WorkerStatus>`
  - `host_load(model_id: String, endpoints: Vec<String>) -> Vec<DeviceShare>` (emits `load-progress { frac }`)
  - `host_generate(messages: Vec<ChatMessage>) -> GenSummary` (emits `token { piece }`)
  - `host_cancel()`
  - `host_unload()`
  - `device_shares() -> Vec<DeviceShare>`
  - `device_info() -> DeviceInfo { name, platform, free_mem_mb: Option<u64>, app_ver, proto }`
- `app/src/lib/tauri.ts`: typed wrappers with the same names in camelCase.

Details:
- Long-running engine calls run on `tauri::async_runtime::spawn_blocking`.
- The temporary screen has buttons and text only, and shows only real values.
- Tailwind 3 and the shadcn@2 init happen in Task 4.1, not here.

Steps:
- [ ] **Write the failing test** `app/src-tauri/src/device_info.rs::tests::reports_platform_and_proto`: assert `platform == "macos"` on macOS and that `proto` is non-empty.
- [ ] Implement, then run `cargo test -p distllm-app` and confirm it passes.
- [ ] **Verify on device:**
  - `npm run tauri dev`, then tap "Start worker".
  - From a terminal, run `llama-cli -m models/<0.8b> -ngl 99 --rpc 127.0.0.1:50052 -no-cnv -p "Hi" -n 8`.
  - The load log shows an RPC buffer > 0 MiB on the app's worker. Record it in `docs/evidence/2.1-mac-app-worker.md`.
- [ ] **Commit:** `feat(app): scaffold Tauri app with engine commands`. Tick the box and push.

### - [ ] Task 2.2 — iOS build: engine cross-compiled, app runs on iPhone as worker

**Files:**
- Create: `app/src-tauri/gen/apple/` (via `npm run tauri ios init`)
- Modify: `engine/build.rs` (iOS target: `CMAKE_SYSTEM_NAME=iOS`, arm64, deployment target 16.0, Metal embed), `app/src-tauri/Info.ios.plist` (`NSLocalNetworkUsageDescription`, `NSBonjourServices = ["_distllm._tcp"]`), `app/src-tauri/tauri.conf.json` (bundle id `com.distllm.app`, signing team = the free personal team)

Steps:
- [ ] Build: `npm run tauri ios build -- --target aarch64` succeeds with the engine linked in.
- [ ] **Verify on device:**
  - Run on the iPhone with `npm run tauri ios dev --host`, allow Local Network, and tap "Start worker".
  - From the Mac, run `llama-cli … --rpc <iphone-ip>:50052`.
  - The load log shows the `RPC[<iphone-ip>:50052]` buffer > 0 MiB, and the generated text is coherent.
  - Record it in `docs/evidence/2.2-iphone-worker.md`.
- [ ] ⚠️ **Decision point:** check whether the `com.apple.developer.kernel.increased-memory-limit` entitlement can be signed with the free team. Record the result. It decides which models the iPhone may host in Task 3.4.
- [ ] **Commit:** `build(ios): cross-compile engine and run app on iPhone as RPC worker`. Tick the box and push.

### - [ ] Task 2.3 — Model downloads (resumable, verified)

**Files:**
- Create: `app/src-tauri/src/models/{mod.rs,catalog.rs,download.rs}`
- Modify: `commands.rs`, `tauri.ts`

**Produces:**
- `catalog() -> Vec<ModelEntry>` (from `catalog.json`, embedded with `include_str!`)
- `model_state(id) -> ModelState`, where `ModelState` is one of `NotDownloaded`, `Partial { bytes }`, `Ready { path }`
- `model_download(id)`, which emits `download-progress { id, bytes, total }`
- `model_cancel_download(id)`
- `model_delete(id)`

Details:
- Files go in `<app_data>/models/<file>`.
- A download writes to `<file>.part` and resumes with an HTTP `Range` header. It's renamed only after SHA-256 matches.
- On a mismatch, it deletes the `.part` file and returns `Err("checksum mismatch")`.

Steps:
- [ ] **Write the failing tests** in `download.rs::tests`. Each runs against a local `tiny_http` server serving fixture bytes; test fixtures are fine.
  - `resumes_from_partial_file`: the server serves a range, and the final hash matches.
  - `rejects_checksum_mismatch`: the result is `Err`, and neither the `.part` nor the final file exists.
  - `partial_is_not_ready`: `model_state` returns `Partial`, never `Ready`.
  - `server_error_keeps_partial_for_resume`.
- [ ] Run the tests, confirm they fail, implement, and confirm they pass.
- [ ] **Verify on device:** download `qwen3.5-0.8b` on the iPhone. Switch Wi‑Fi off and on mid-download, and it resumes. Its state ends `Ready`.
- [ ] **Commit:** `feat(app): resumable, checksum-verified model downloads`. Tick the box and push.

### - [ ] Task 2.4 — P0 milestone: iPhone hosts with the Mac as worker, and the reverse

**Files:**
- Modify: `app/src/App.tsx` (temporary screen: manual endpoint field, model select, load, chat box, shares list)
- Create: `docs/evidence/2.4-p0-split.md`

Steps:
- [ ] **Verify on device, iPhone host:**
  - The Mac app is a worker. The iPhone app loads `lfm3-1.7b` with `<mac-ip>:50052`.
  - The shares list shows the iPhone (Metal) and the Mac (RPC) with real MiB values.
  - A 3-turn chat works.
  - Quitting the Mac app mid-answer behaves as decided in 1.3.
- [ ] **Verify on device, Mac host:** the same steps the other way round.
- [ ] Repeat the load-and-chat check for `qwen3.5-2b` and `qwen3.5-0.8b` with the iPhone hosting.
- [ ] Record screenshots and shares tables in the evidence file.
- [ ] **Commit:** `test: P0 split verified iPhone↔Mac in both directions`. Tick the box and push.

---

## Phase 3 — Discovery, roles and safety checks (P0)

### - [ ] Task 3.1 — TXT record and compatibility rules

**Files:**
- Create: `app/src-tauri/src/discovery/{mod.rs,txt.rs}`

**Produces:**
- `DeviceRole` is one of `Idle`, `Worker`, `Host` (also used by `RoleState` in 3.4)
- `PeerInfo { id: String, name: String, platform: String, app_ver: String, proto: String, rpc_port: u16, free_mem_mb: Option<u64>, role: DeviceRole, addr: IpAddr, last_seen: Instant }`
- `encode_txt(&PeerInfo) -> Vec<(String,String)>`
- `decode_txt(&[(String,String)], addr) -> Result<PeerInfo>`
- `compatibility(&PeerInfo, local: &DeviceInfo) -> Compat`, where `Compat` is one of `Ok`, `AppVersionMismatch`, `ProtoMismatch`

Steps:
- [ ] **Write the failing tests:**
  - `roundtrip_txt`
  - `missing_free_mem_is_none_not_zero`
  - `proto_mismatch_is_incompatible`
  - `app_ver_mismatch_is_incompatible`
  - `unknown_keys_ignored`
- [ ] Run the tests, confirm they fail, implement, and confirm they pass.
- [ ] Also add the guard in `host_load`: when any endpoint's peer is incompatible, return `Err("incompatible version: <name>")` before connecting. Add the test `host_load_refuses_incompatible_peer`.
- [ ] **Commit:** `feat(discovery): TXT record schema and version compatibility`. Tick the box and push.

### - [ ] Task 3.2 — mDNS on macOS (advertise and browse)

**Files:**
- Create: `app/src-tauri/src/discovery/mdns.rs`
- Modify: `commands.rs`, `tauri.ts`

**Produces:**
- `discovery_start()`, which emits `peers-changed { peers: Vec<PeerView> }`
- `PeerView = PeerInfo + compat`
- Advertising starts automatically when the device becomes a worker.
- A peer expires 15 s after its last announcement.
- `add_manual_peer(addr: String)` probes TCP within 5 s and adds the peer with `name = addr` and `free_mem_mb = None`.

Steps:
- [ ] **Write the failing tests:**
  - `advertise_then_browse_finds_self` (loopback; the peer is found within 5 s)
  - `peer_expires_after_ttl` (inject the clock)
  - `manual_peer_dead_endpoint_errors_within_5s`
- [ ] Run the tests, confirm they fail, implement with `mdns-sd`, and confirm they pass.
- [ ] **Commit:** `feat(discovery): mDNS advertise/browse with expiry and manual peers`. Tick the box and push.

### - [ ] Task 3.3 — iOS Bonjour plugin, plus keeping the screen awake

**Files:**
- Create: `app/src-tauri/plugins/bonjour-ios/` (Tauri 2 mobile plugin: Swift `NWListener` to advertise, `NWBrowser` to browse and resolve TXT, `UIApplication.shared.isIdleTimerDisabled` toggle)
- Modify: `discovery/mod.rs` (`#[cfg(target_os = "ios")]` routes to the plugin; others use `mdns.rs`)

Details:
- Same events and the same `PeerInfo`. The Swift plugin returns TXT as key/value pairs, and Rust decodes them with `decode_txt`.
- The screen is kept awake while the device is a Worker or a Host with a model loaded.

Steps:
- [ ] **Verify on device:** with the Mac and iPhone both running the app, each lists the other within 5 s with real free memory. Turning the iPhone's Wi‑Fi off removes it from the Mac's list within 20 s.
- [ ] Record it in `docs/evidence/3.3-bonjour.md`.
- [ ] **Commit:** `feat(ios): native Bonjour discovery plugin and keep-awake`. Tick the box and push.

### - [ ] Task 3.4 — Role manager and load guards

**Files:**
- Create: `app/src-tauri/src/roles.rs`, `app/src-tauri/src/chat.rs`
- Modify: `commands.rs`

**Produces:**
- `RoleState` is one of `Idle`, `Worker { status }`, `Host { model_id, shares }` and `Loading { model_id, frac }`
- `role_state() -> RoleState`
- `become_worker()`
- `become_host(model_id, peer_ids: Vec<String>) -> Vec<DeviceShare>`
- `leave_role()`
- The `role-changed` event
- `chat_send(text) -> GenSummary` keeps the session history in `chat.rs`
- `chat_reset()`

Rules:
- Moving between Worker and Host follows Task 1.1's stop decision.
- Load guard: if `model.min_free_mb > local free_mem_mb + Σ peer free_mem_mb`, or if the local share alone would exceed the local free memory with no peers, return `Err("not enough memory: need X MB, have Y MB")` before loading.
- An unknown free memory counts as 0 for the guard.

Steps:
- [ ] **Write the failing tests:**
  - `idle_to_worker_to_idle_transitions`
  - `cannot_host_while_loading`
  - `guard_refuses_when_memory_insufficient`
  - `guard_counts_unknown_memory_as_zero`
  - `chat_history_resets_on_new_model`
- [ ] Run the tests, confirm they fail, implement, and confirm they pass.
- [ ] **Commit:** `feat(app): role state machine, chat session and memory guard`. Tick the box and push.

---

## Phase 4 — The real UI (P0)

Goal: a polished, product-quality interface driven only by real data. Use the frontend-design skill for direction. Every screen has real empty, loading and error states.

### - [ ] Task 4.1 — Design system and app shell

**Files:**
- Create: `app/tailwind.config.js` (Tailwind 3), `app/src/app/{theme.css,Shell.tsx,routes.tsx}`, `app/src/components/ui/*` (via `npx shadcn@2 add button card badge sheet dialog progress input scroll-area tooltip`), `app/src/lib/stores.ts` (Zustand, fed only by Tauri events and commands)

Details:
- Design tokens are CSS variables for a neutral palette with one accent, in light and dark. Choose typography and spacing scales.
- Shell: bottom tab bar on phone (Devices, Models, Chat), sidebar on desktop (≥ 900 px), and the split view docked on the right on desktop.
- Safe-area insets on iOS.

Steps:
- [ ] **Write the failing tests** with Vitest:
  - `Shell renders phone tabs under 900px and sidebar above`
  - `stores start empty (no seeded devices/models)`
- [ ] Implement, then confirm `npm test` passes.
- [ ] **Verify on device:** the shell looks right on the iPhone and the Mac, in light and dark. Screenshots go in the evidence.
- [ ] **Commit:** `feat(ui): design tokens, theme and responsive app shell`. Tick the box and push.

### - [ ] Task 4.2 — Devices screen

**Files:**
- Create: `app/src/features/devices/{DevicesScreen.tsx,ThisDeviceCard.tsx,PeerRow.tsx,AddPeerDialog.tsx}`, plus tests next to them

**Contents:**
- This device: name, platform, free memory, role control (Idle / Worker / Host) and RPC status.
- Nearby list: platform icon, free memory or "unknown", compat badge (incompatible rows are disabled with the reason), and a checkbox to select the peer for hosting.
- Add by address.
- Empty state: "No devices found yet. Make sure others are on the same Wi‑Fi with the app open."

Steps:
- [ ] **Write the failing tests:**
  - `incompatible peer is not selectable and shows reason`
  - `unknown memory renders "unknown"`
  - `empty list shows guidance`
- [ ] Implement, then confirm the tests pass.
- [ ] **Verify on device:** the iPhone and the Mac show each other.
- [ ] **Commit:** `feat(ui): devices screen with discovery, roles and manual add`. Tick the box and push.

### - [ ] Task 4.3 — Models screen

**Files:**
- Create: `app/src/features/models/{ModelsScreen.tsx,ModelCard.tsx}`, plus tests

**Contents:**
- One card per catalog model: name, vendor, parameters, size.
- State: download / progress with cancel / Ready with delete.
- A "Fits with selected devices?" hint uses the same rule as the Task 3.4 guard.
- A Load button, enabled only when Ready and a role choice allows it.

Steps:
- [ ] **Write the failing tests:**
  - `partial download shows resume, not ready`
  - `load disabled when guard fails, with reason`
- [ ] Implement, then confirm the tests pass.
- [ ] **Verify on device:** download and delete on the iPhone.
- [ ] **Commit:** `feat(ui): models screen with downloads and fit check`. Tick the box and push.

### - [ ] Task 4.4 — Chat screen

**Files:**
- Create: `app/src/features/chat/{ChatScreen.tsx,MessageList.tsx,Composer.tsx}`, plus tests

**Contents:**
- Streaming assistant text, stop button, new chat.
- The header shows the model and the devices in use.
- The error banner covers worker lost, out of memory and not loaded, each with an action (Reconnect / Choose devices).
- Tokens/s comes from the real `GenSummary`.

Steps:
- [ ] **Write the failing tests:**
  - `tokens append in order from events`
  - `stop calls host_cancel`
  - `worker-lost error shows banner and disables composer`
- [ ] Implement, then confirm the tests pass.
- [ ] **Verify on device:** chat from the iPhone host.
- [ ] **Commit:** `feat(ui): streaming chat with stop and error states`. Tick the box and push.

### - [ ] Task 4.5 — Split view

**Files:**
- Create: `app/src/features/split/{SplitView.tsx,DeviceBar.tsx}`, plus tests

**Contents:**
- One row per `DeviceShare`: device name, local/RPC badge, layer range (or "unknown"), MiB held, proportional bar.
- The total is shown in MiB.
- A "Source: llama.cpp load report" footnote.
- It's a docked panel on desktop and a sheet opened from the chat header on the phone.

Steps:
- [ ] **Write the failing tests:**
  - `bars proportional to buffer_mib`
  - `unknown layers render "unknown"`
  - `renders nothing but empty state when no model loaded`
- [ ] Implement, then confirm the tests pass.
- [ ] **Verify on device:** the iPhone hosting shows real shares that match the engine log.
- [ ] **Commit:** `feat(ui): live split view from llama.cpp device shares`. Tick the box and push.

### - [ ] Task 4.6 — UI polish pass on device

**Files:**
- Modify: files in `app/src/**` as needed
- Create: `docs/evidence/4.6-ui.md` (screenshots of every screen and state, iPhone and Mac, light and dark)
- Create: About sheet (`app/src/app/About.tsx`) with the version, llama.cpp commit, proto version and the trusted-LAN notice

Steps:
- [ ] Review against the frontend-design checklist: spacing, hierarchy, touch targets ≥ 44 pt, focus rings, contrast AA, motion only where it helps (respecting reduced motion).
- [ ] **Verify:** `npm test` and `cargo test` pass, plus a full manual run on the iPhone and the Mac.
- [ ] **Commit:** `feat(ui): polish pass and about sheet`. Tick the box and push.

---

## Phase 5 — Android (P1)

### - [ ] Task 5.1 — Android build: app runs as worker on the phone

**Files:**
- Create: `app/src-tauri/gen/android/` (via `npm run tauri android init`)
- Modify: `engine/build.rs` (Android target: NDK toolchain `$NDK_HOME/build/cmake/android.toolchain.cmake`, `ANDROID_ABI=arm64-v8a`, `ANDROID_PLATFORM=android-28`, CPU backend, Metal off), `AndroidManifest.xml` (INTERNET, ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE, WAKE_LOCK)

Steps:
- [ ] Build: `npm run tauri android build -- --target aarch64 --apk` succeeds.
- [ ] **Verify on device:**
  - Install with `adb install`, then start the worker on the Android phone.
  - The Mac app hosts `qwen3.5-0.8b` with it.
  - The shares show `RPC[<android-ip>]` > 0 MiB and chat works.
  - Record it in `docs/evidence/5.1-android-worker.md`.
- [ ] **Commit:** `build(android): cross-compile engine and run app as RPC worker`. Tick the box and push.

### - [ ] Task 5.2 — Android discovery and Android as host

**Files:**
- Create: `app/src-tauri/plugins/multicast-android/` (Kotlin: acquire `WifiManager.MulticastLock` while discovery runs, `FLAG_KEEP_SCREEN_ON` while Worker or Host)

Steps:
- [ ] **Verify on device:**
  - The Android phone, iPhone and Mac all see each other.
  - The Android phone hosts `qwen3.5-0.8b` with the Mac as worker, and chat works.
  - All three devices in one split: the iPhone hosts with the Mac and Android as workers.
  - Record it in `docs/evidence/5.2-three-device-split.md`.
- [ ] **Commit:** `feat(android): multicast discovery, keep-awake and Android host`. Tick the box and push.

---

## Phase 6 — Verification, docs, release and project page

### - [ ] Task 6.1 — Device test checklist (acceptance)

**Files:**
- Create: `docs/test-checklist.md`

Steps:
- [ ] Write the matrix from plan.md's acceptance criteria and the Review Focus items: each scenario, the expected result, the actual result, and an evidence link.
- [ ] Run every row on real devices with the release builds. Every P0 row must pass.
- [ ] Fix anything that fails, in its own `fix:` commits.
- [ ] **Commit:** `docs: device test checklist with results`. Tick the box and push.

### - [ ] Task 6.2 — README

**Files:**
- Create: `README.md`

**Contents:**
- What it is
- Architecture diagram
- Prerequisites (Xcode, Rust targets, Android SDK and NDK, env vars)
- Build and run per platform
- iOS free-account signing and the 7-day reinstall
- The demo script
- Models
- Limitations, including the trusted-LAN-only warning
- Troubleshooting (Local Network permission, client isolation, version mismatch)

Steps:
- [ ] **Verify:** follow the README from a clean clone (`git clone --recursive`) on this Mac. It builds and runs.
- [ ] **Commit:** `docs: README with setup, demo and limitations`. Tick the box and push.

### - [ ] Task 6.3 — Release builds and demo video

**Files:**
- Create: `docs/release.md` (how the builds were produced, versions, checksums)

Steps:
- [ ] Build the macOS `.dmg` (`npm run tauri build`) and the Android release APK (signed with a local release keystore that is never committed). The iOS build is installed via Xcode, as documented.
- [ ] ⚠️ **Decision point (user):** the repo is private, so where do public downloads live? Options are a GitHub Release on a public repo, Vercel static assets, or Vercel Blob. Record the decision.
- [ ] Record the demo video of the real app (iPhone host + Mac worker, split view visible, worker-loss behaviour). Keep it out of git and link it from the release location.
- [ ] **Commit:** `chore: release builds and demo`. Tick the box and push.

### - [ ] Task 6.4 — Project page on Vercel

**Files:**
- Create: `site/` (static, Vite + React + Tailwind, sharing the app's design tokens), `site/vercel.json`

**Contents:**
- Hero, how it works (architecture diagram)
- The real demo video
- Real screenshots from `docs/evidence/4.6-ui.md`
- Download links per Task 6.3
- Setup steps, limitations
- No simulated UI and no sample data.

Steps:
- [ ] **Verify locally:** `npm run build` passes. Check the page at 375 px and 1440 px, in light and dark, and confirm every link resolves.
- [ ] ⚠️ **Decision point (user):** which Vercel account or team, and the project name. Then deploy (`vercel deploy --prod`) and check the live URL.
- [ ] **Commit:** `feat(site): project page deployed on Vercel`. Tick the box and push.
