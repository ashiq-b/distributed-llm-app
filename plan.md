# Distributed On-Device LLM App — Plan

## Goal

One cross-platform app (iOS, macOS, Android) that splits a **single small language model across several devices on the same Wi‑Fi**, using llama.cpp's built-in RPC. Any device can run the chat while the others lend their memory and compute. The split is real and verified by llama.cpp's own reporting. The aim is a working product with a polished UI. Speed is not a goal.

## Priorities

| Priority | Scenario | Why |
|---|---|---|
| **P0** | iPhone as host, Mac as worker | Hardest case, and the core demo: chat on a phone, model split across devices |
| **P0** | Mac as host, iPhone as worker | Shows that both devices can take either role |
| **P0** | A polished, working UI on iPhone and Mac | Discovery, model downloads, chat, and a live view of the split |
| **P1** | Android as host and as worker | Completes the three-platform story; built from the same codebase |
| **P1** | Project page on Vercel | One shareable link: what it is, demo, downloads, setup |

## Requirements

1. **One codebase** (Tauri 2 + React) builds for iOS, macOS and Android.
2. **llama.cpp is built into every app**, pinned to the same version on every platform.
3. **Two roles on every device:**
   - **Host:** holds the model file, runs the chat, and coordinates the work.
   - **Worker:** lends memory and compute by running llama.cpp's RPC server inside the app.
4. **Device discovery:** devices on the same network find each other automatically (Bonjour/mDNS). Entering an address manually is the fallback.
5. **Model split:** the host attaches the selected workers, and llama.cpp divides the model across all devices by each one's free memory.
6. **Models:** the latest small models (see below), downloaded in the app on demand.
7. **UI:** clean, modern and fully functional. Device list, model library, chat, and a live view of how the model is split (layers and memory per device). Neutral, well-matched colour palette; no brand colours for now.
8. **Real data only:** every number, status and device shown in the app comes from the running system. No mock data, placeholders or simulated results.
9. **Project page:** a website hosted on Vercel with the overview, a recorded demo of the real app, real screenshots, download links and setup steps.
10. **Documentation:** setup, running the demo, and known limitations.

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
- **Transport:** llama.cpp's built-in RPC protocol over TCP.
- **Discovery:** Bonjour/mDNS, built as part of this project because llama.cpp has none.
- **Project page:** a static site on Vercel, separate from the app. It links to the builds and shows the real demo; it doesn't run inference itself, since browsers can't make the direct device-to-device connections llama.cpp needs.

## Models

| Model | Released | Parameters | Approx. download (4-bit) | Role |
|---|---|---|---|---|
| [LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF) (Liquid AI) | Oct 2026 | 1.7B | ~1.05 GB | Main demo model |
| [Qwen3.5-2B](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF) (Qwen) | 2026 | 2B | ~1.3 GB | Largest of the three |
| [Qwen3.5-0.8B](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF) (Qwen) | 2026 | 0.8B | ~0.5 GB | Low-storage devices |

Each model is checked to load and chat correctly **in split mode** before it ships in the catalog. If one fails, it's replaced with the next-newest model under 3B. Models are downloaded in the app, not bundled, so installs stay small.

## Deliverables

- Source code repository
- Builds: iOS app (installed from Xcode), macOS app, Android APK
- Project page on Vercel
- README: setup, demo steps, limitations
- Demo video of the real app: one model split across an iPhone and a Mac, plus Android where available

## Acceptance criteria

- **P0:** With the iPhone as host, one model loads split across the iPhone and the Mac, and chat works.
- **P0:** With the Mac as host, one model loads split across the Mac and the iPhone, and chat works.
- **P0:** The UI shows each device's share (layers and memory), taken from llama.cpp's own data.
- **P0:** Stopping a worker mid-answer stops generation with a clear error. This proves the worker was really doing the work.
- **P1:** The Android app joins as a worker and as a host.
- **P1:** The project page is live on Vercel.
- No mock data, simulated results or faked distribution anywhere in the app or on the project page.

## Expectations and limitations

- **Speed is not a goal.** Splitting over Wi‑Fi will likely be slower than running on one device.
- **Local network only.** No internet or remote devices.
- **No security layer.** llama.cpp's RPC has no authentication or encryption, so use it only on trusted networks. This is accepted for the prototype.
- **iOS:**
  - The app must stay open in the foreground while it works.
  - Test builds are installed from Xcode and must be reinstalled every 7 days.
- **Test builds only** for delivery. No app store releases yet.
- **Desktop is macOS for now.** The stack (Tauri, llama.cpp) supports Windows and Linux, and the code will avoid macOS-only shortcuts so those can be added later.
- **First model load sends 0.5–1.3 GB over Wi‑Fi** and can take a minute or more. Later loads are faster thanks to caching.
- **Same app version everywhere.** All devices must run the same version to connect.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| No official mobile support for llama.cpp RPC | iOS/Android builds may need fixes | Validated on a real iPhone first, before any UI work |
| Newest model architectures (LFM3, Qwen3.5) may not fully work in split mode | A model fails to load or gives wrong output across devices | Each model verified in split mode early; replaced if it fails |
| iPhone memory limits (~3 GB per app) | Large models can't be hosted on the iPhone | All three models are ≤2B and fit; workers take a share as well |
| iOS suspends networking in the background | iPhone drops out mid-session | Keep the screen awake while active; documented |
| iOS network restrictions on test builds | Auto-discovery may fail on iPhone | Apple's native Bonjour, with manual address entry as fallback |
| Mid-range Android hardware, limited storage | Slow generation, room for one model | Acceptable; Android is P1 and uses the smallest model |
| llama.cpp RPC protocol changes between versions | Devices fail to connect | One pinned llama.cpp version in all builds |

## Decisions confirmed

- llama.cpp's built-in RPC is used as the transport.
- Desktop target is macOS for now; Windows and Linux later.
- Models: latest small models (LFM3, Qwen3.5 families).
- UI: clean and functional, neutral palette, no brand colours yet.
- Delivery: test builds.
- Security: trusted local network only, accepted for the prototype.
- Demo: real devices, plus a project page on Vercel.
