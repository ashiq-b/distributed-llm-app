# Distributed On-Device LLM App — Plan

## Goal

One cross-platform app (iOS, macOS, Android) that splits a **single small language model across several devices on the same Wi‑Fi**, using llama.cpp's built-in RPC. Any device can run the chat while the others lend their memory and compute. The split is real and verified by llama.cpp's own reporting. The goal is a working prototype with a polished UI, not speed.

## Priorities

| Priority | Scenario | Why |
|---|---|---|
| **P0** | iPhone as host, Mac as worker | Hardest case, and the core demo: chat on a phone, model split across devices |
| **P0** | Mac as host, iPhone as worker | Shows that both devices can take either role |
| **P0** | A polished, working UI on iPhone and Mac | Discovery, model downloads, chat, and a live view of the split |
| **P1** | Android as host and as worker | Completes the three-platform story; built from the same codebase |

## Requirements

1. **One codebase** (Tauri 2 + React) builds for iOS, macOS and Android.
2. **llama.cpp is built into every app**, pinned to the same version on every platform.
3. **Two roles on every device:**
   - **Host:** holds the model file, runs the chat, and coordinates the work.
   - **Worker:** lends memory and compute by running llama.cpp's RPC server inside the app.
4. **Device discovery:** devices on the same network find each other automatically (Bonjour/mDNS). Entering an address manually is the fallback.
5. **Model split:** the host attaches the selected workers, and llama.cpp divides the model across all devices by each one's free memory.
6. **Models:** 2–3 recent GGUF models under 3B parameters, downloaded in the app on demand.
7. **UI:** clean, modern and fully functional. Device list, model library, chat, and a live view of how the model is split (layers and memory per device).
8. **Documentation:** setup, running the demo, and known limitations.

## Architecture

```
            Same Wi‑Fi network (TCP, llama.cpp RPC)
 ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
 │  iPhone (Host)   │◀──────▶│   Mac (Worker)   │        │ Android (Worker) │
 │  model file      │        │ RPC server       │        │ RPC server       │
 │  chat + control  │◀──────────────────────────────────▶│                  │
 │  layers 0–9      │        │ layers 10–19     │        │ layers 20–27     │
 └──────────────────┘        └──────────────────┘        └──────────────────┘
        Any device can take either role · Discovery via Bonjour/mDNS
```

Each app has three layers:

```
 ┌───────────────────────────────────────────────┐
 │  UI — React + TypeScript (shared everywhere)  │
 ├───────────────────────────────────────────────┤
 │  App core — Rust (Tauri 2)                    │
 │  discovery · model downloads · host/worker    │
 ├───────────────────────────────────────────────┤
 │  Engine — llama.cpp (C/C++) + thin C wrapper  │
 │  inference · RPC server · RPC client          │
 └───────────────────────────────────────────────┘
```

- **App shell:** Tauri 2. One React UI for every platform, and a Rust core underneath.
- **Engine integration:** llama.cpp is compiled for each platform (Metal on Apple devices) with the RPC backend enabled, and exposed to Rust through a small wrapper of our own. Everything runs **inside the app**, which iOS requires, since iOS apps can't launch separate programs.
- **Transport:** llama.cpp's own RPC protocol over plain TCP. The brief mentions gRPC, but llama.cpp's built-in RPC isn't gRPC; we use it as is.
- **Discovery:** Bonjour/mDNS, built as part of this project because llama.cpp has none.

## Models (provisional, confirmed at kickoff)

| Model | Parameters | Approx. download (4-bit) |
|---|---|---|
| Qwen3 1.7B | 1.7B | ~1.1 GB |
| Gemma 3 1B | 1B | ~0.8 GB |
| SmolLM3 3B or LFM2 2.6B | 2.6–3B | ~1.6–1.9 GB |

The final picks will be the newest models under 3B that the pinned llama.cpp version supports. Models are downloaded in the app, not bundled, so installs stay small.

## Deliverables

- Source code repository
- Builds: iOS app (installed from Xcode), macOS app, Android APK
- README: setup, demo steps, limitations
- Demo video: one model split across an iPhone and a Mac, plus Android where available

## Acceptance criteria

- **P0:** With the iPhone as host, one model loads split across the iPhone and the Mac, and chat works.
- **P0:** With the Mac as host, one model loads split across the Mac and the iPhone, and chat works.
- **P0:** The UI shows each device's share (layers and memory), taken from llama.cpp's own data.
- **P1:** The Android app joins as a worker and as a host.
- No simulated or faked distribution anywhere in the app.

## Expectations and limitations

- **Speed is not a goal.** Splitting over Wi‑Fi will likely be slower than running on one device.
- **Local network only.** No internet or remote devices.
- **No security layer.** llama.cpp's RPC has no authentication or encryption, so use it only on trusted networks.
- **iOS:**
  - The app must stay open in the foreground while it works.
  - With a free developer account, builds must be reinstalled every 7 days.
- **Test builds only.** No app store releases.
- **Desktop is macOS first.** Windows and Linux are possible later but untested in v1.
- **First model load sends 1–2 GB over Wi‑Fi** and can take a minute or more. Later loads are faster thanks to caching.
- **Same app version everywhere.** All devices must run the same version to connect.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No official mobile support for llama.cpp RPC | iOS/Android builds may need fixes | Validated on a real iPhone first, before any UI work |
| iPhone memory limits (~3 GB per app) | iPhone may not host the 3B model | iPhone hosts the 1–2B models, with workers taking a share; 3B is hosted from the Mac |
| iOS suspends networking in the background | iPhone drops out mid-session | Keep the screen awake while active; documented |
| iOS network restrictions on free accounts | Auto-discovery may fail on iPhone | Apple's native Bonjour, with manual address entry as fallback |
| Mid-range Android hardware, limited storage | Slow generation, room for one model only | Acceptable; Android is P1 and uses the smallest model |
| llama.cpp RPC protocol changes between versions | Devices fail to connect | One pinned llama.cpp version in all builds |

## Assumptions

- llama.cpp's built-in RPC (TCP) is acceptable in place of gRPC.
- iOS and macOS are the primary targets; Android follows from the same codebase.
- Test builds are enough for delivery.
- The demo runs on a trusted home or office Wi‑Fi network.
