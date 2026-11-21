# Device test checklist (acceptance)

Every row is one scenario from [plan.md](../plan.md)'s acceptance criteria or the review focus (the failure cases the happy path doesn't cover), run on real devices with the **release builds**.

**Builds under test** (macOS and iOS from `d917e47`, Android from `463669e`, app 0.1.0, llama.cpp v1.0.0, RPC protocol 10.0.0):

| Platform | Build | Size |
|---|---|---|
| macOS | `npm run tauri build` → `DistLLM.app`, `DistLLM_0.1.0_aarch64.dmg` | 15.5 MiB app, 6.0 MiB dmg |
| iOS | `npm run tauri ios build -- --target aarch64 --export-method debugging`, free personal team | 5.8 MB ipa |
| Android | `npm run tauri android build -- --target aarch64 --apk`, signed with a local release key | 14.5 MB apk |

**Devices:** MacBook Air (Apple M5, macOS 26), iPhone 15 (`iPhone15,4`), Android emulator (arm64, Android 14; no Android phone was available). All on one home Wi‑Fi. The Mac is `192.168.1.7`.

**Result key:**
- **Pass:** seen on the devices with the release builds.
- **Pass (earlier build):** passed on the devices with a debug build (evidence linked), and not repeated with the release build.
- **Tests only:** covered by automated tests, with no on-device result.
- **Not run:** with the reason.

**How results were recorded:** the Mac release app ran with its log saved to a file, so llama.cpp's own lines (layer offload, each device's buffer size, worker connections and disconnections) are the record for the Mac side. The tester ran the iPhone and Mac steps and reported anything that didn't match. They reported nothing. No screenshots were taken in this session; earlier screenshots are in each linked evidence file.

## Acceptance criteria (plan.md)

| # | Pri | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|
| A1 | P0 | iPhone hosts, Mac is the worker: load and chat | The model loads split across both, and the answer streams | The Mac (Worker) accepted the iPhone's connection, received its layers (113 weight blocks written to its cache) and ran its share of each token. The tester saw the answer on the iPhone. | **Pass** | Mac log; [2.4](evidence/2.4-p0-split.md), [4.4](evidence/4.4-chat.md) |
| A2 | P0 | Mac hosts, iPhone is the worker: load and chat | Same, the other way round | llama.cpp on the Mac: `offloaded 26/26 layers`, `RPC0[192.168.1.4:50052] model buffer size = 150.10 MiB` (the iPhone), `MTL0_Mapped 356.02 MiB` (the Mac), Qwen3.5 0.8B. The answer came back on the Mac. | **Pass** | Mac log; [2.4](evidence/2.4-p0-split.md) |
| A3 | P0 | The UI shows each device's share, from llama.cpp's own data | Layers and memory per device match llama.cpp's load report | The split view's numbers are parsed from the same load-log lines shown in A2. Checked line by line: for Qwen3.5 2B the app's total (1,211.0 MiB) equals llama.cpp's (1,211.04 MiB). | **Pass** | [4.5](evidence/4.5-split-view.md), [5.2](evidence/5.2-three-device-split.md) |
| A4 | P0 | A worker stops mid-answer | Generation stops with a clear error, and the app stays open | The Mac was switched to Idle while the iPhone was writing a 400-word answer. The Mac's log shows the connection closing at that moment. The iPhone showed "A device dropped out", kept the conversation, and Reconnect loaded the model again once the Mac was a worker. | **Pass** | Mac log; [3.4](evidence/3.4-roles.md), [4.4](evidence/4.4-chat.md) |
| A5 | P0 | Polished, working UI on iPhone and Mac: discovery, downloads, chat, split view | Every screen works in dark and light, phone and desktop widths | Used throughout this session on the release builds. Full review in 4.6. | **Pass** | [4.6](evidence/4.6-ui.md) |
| A6 | P1 | Android joins as a worker | Its share holds layers and the answer is right | Android release APK on the emulator, Worker; Mac host (engine command line, through `adb forward`): `127.0.0.1:50062 106.27 MiB layers 0-4`, `Apple M5 657.51 MiB layers 5-25`, "The capital of France is Paris.", 28.6 tokens/s | **Pass** (emulator) | [5.1](evidence/5.1-android-worker.md) |
| A7 | P1 | Android hosts | Android loads with the Mac as worker, and chat works | Passed with the debug build: Android layers 0–4, Mac 5–25, correct answers. Not repeated with the release APK, which would need the model downloaded again on the emulator. | **Pass (earlier build)**, emulator | [5.2](evidence/5.2-three-device-split.md) |
| A8 | P1 | All three in one split | iPhone hosts with the Mac and Android as workers | Android 0–3, Mac 4–20, iPhone 21–25; "The capital of France is Paris." | **Pass (earlier build)**, emulator | [5.2](evidence/5.2-three-device-split.md) |
| A9 | P1 | Project page live on Vercel | | Cut by the owner's decision (Task 6.4). The README is the shareable overview. | **Not run** | |
| A10 | — | No mock data, simulated results or faked distribution | Every device, number and status comes from the running system | Stores start empty (test `stores start empty (no seeded devices/models)`). Unknown values show "unknown", e.g. a device added by address shows "free memory unknown". Each share comes from llama.cpp's log (A2, A3). | **Pass** | [4.1](evidence/4.1-shell.md), [4.5](evidence/4.5-split-view.md) |

## Failure cases (review focus)

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| F1 | A worker disappears mid-answer without closing (Wi‑Fi drop) | The host ends with a clear "worker lost" error and never hangs | The Mac hosted, with the iPhone as worker. Airplane Mode was turned on on the iPhone mid-answer. llama.cpp on the Mac: `RPC server 192.168.1.4:50052 disconnected (GET_TENSOR failed)`. The Mac showed "A device dropped out" and stayed open. | **Pass** | Mac log; [2.4](evidence/2.4-p0-split.md) |
| F2 | Version mismatch | A device with a different app or RPC version shows as incompatible, can't be chosen, and is never connected to | Tests pass: `proto_mismatch_is_incompatible`, `app_ver_mismatch_is_incompatible`, and the UI test `incompatible peer is not selectable and shows reason`. The on-device check used a test announcement from the Mac (`dns-sd`, app 0.0.9, RPC 9.0.0). It had no heartbeat, so it appeared and then expired after 15 s (see F4), and the "incompatible" row couldn't be checked reliably on screen. An on-device check needs a second, older build of the app. | **Tests only** | [3.1 tests](../app/src-tauri/src/discovery/txt.rs), [4.2](evidence/4.2-devices.md) |
| F3 | The model doesn't fit | Refused before loading with a clear message, never an out-of-memory kill | Load is disabled with "Doesn't fit: needs … MiB free, these devices have … MiB", on Models and (since this phase) in Chat. The host's own guard refuses too (`guard_refuses_when_memory_insufficient`, `guard_counts_unknown_memory_as_zero`). Every catalog model fits on each of our devices, so the refusal can't be triggered on them. | **Tests only** | [3.4](evidence/3.4-roles.md), [4.3](evidence/4.3-models.md) |
| F4 | Stale peers: a device sleeps or leaves | It drops off the list; connecting to a dead address fails within 5 s | On the devices: a device that quits says goodbye and is gone in about 1 s. A device that goes silent expires after 15 s: the iPhone in Airplane Mode (this session), the iPhone with Wi‑Fi off (3.3), and the heartbeat-less test announcement on Android (F2). A dead address fails within 5 s: `manual_peer_dead_endpoint_errors_within_5s`, `load_fails_fast_on_dead_endpoint` (tests). | **Pass** (expiry); **Tests only** (dead address) | [3.3](evidence/3.3-bonjour.md), [3.4](evidence/3.4-roles.md) |
| F5 | Interrupted or corrupt download | Resumes; a hash mismatch deletes the file and reports it; a partial file is never offered as downloaded | On the iPhone, a real download survived losing the network, resumed from the same byte, and was verified (debug build). A partial download shows "Paused at N%" with Resume, never Load (iPhone, Android). A corrupt file can't be produced from the real server, so the hash check is covered by `rejects_checksum_mismatch` and by `fetch-model.sh` against a wrong hash. | **Pass (earlier build)**; **Tests only** (hash mismatch) | [2.3](evidence/2.3-downloads.md), [4.3](evidence/4.3-models.md), [5.1](evidence/5.1-android-worker.md) |

## Found and fixed

| Problem | Fix |
|---|---|
| The macOS release build failed to link (`___isPlatformVersionAtLeast`) from a clean clone. Every earlier Mac run was a debug build. | `d917e47`: link clang's runtime on macOS |
| The Android release APK was unsigned, and the release shrinker could strip the insets bridge | `463669e`: sign from a local keystore, keep `@JavascriptInterface` methods |

## Automated tests (release commit, fresh clone)

`npm test`: 54 passed. `cargo test -p distllm-app`: 43 passed, 1 ignored (a real 830 MB download). `cargo test -p dl-engine`: passed; the model tests skip unless `DL_TEST_MODEL` is set.

## Not covered

- **A real Android phone.** Every Android row ran on the emulator.
- **F2 on screen,** which needs an older build of the app to run alongside.
