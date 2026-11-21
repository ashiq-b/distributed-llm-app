# DistLLM

**One small language model, split across the phones and computers on your Wi‑Fi.**

DistLLM is one app for iPhone, Mac and Android. Any device can **host**: it holds the model file and runs the chat. The other devices become **workers**: they lend their memory and processor and each runs a block of the model's layers. Under the hood it is [llama.cpp](https://github.com/ggml-org/llama.cpp) built into the app, using llama.cpp's own RPC to talk between devices, plus our own discovery (Bonjour/mDNS) and UI.

Everything the app shows comes from the running system: the devices it found, their free memory, and the layers and memory each one holds, read from llama.cpp's own load report. Nothing is simulated.

| | |
|---|---|
| Platforms | iOS (iPhone), macOS (Apple silicon), Android (arm64) |
| Engine | llama.cpp `v1.0.0` (pinned, [`engine/LLAMA_CPP_VERSION`](engine/LLAMA_CPP_VERSION)), Metal on Apple devices, CPU on Android |
| App | [Tauri 2](https://tauri.app): a React + TypeScript UI over a Rust core |
| Network | Same Wi‑Fi only. Discovery over mDNS (`_distllm._tcp`), model layers over llama.cpp RPC (TCP port 50052) |

**Speed is not the goal.** Splitting lets a model run that is too big for one device. If the model fits on one device, splitting makes it slower, because every token has to cross the Wi‑Fi to each worker and back. The app says so before you load. Measured with Qwen3.5 0.8B ([5.2](docs/evidence/5.2-three-device-split.md)): iPhone alone 22.6 tokens/s, iPhone + Mac 5.8, iPhone + Mac + Android 3.2.

## How it works

```
                Same Wi‑Fi (llama.cpp RPC over TCP, port 50052)
 ┌───────────────────┐        ┌───────────────────┐        ┌───────────────────┐
 │   iPhone (Host)   │◀──────▶│   Mac (Worker)    │        │ Android (Worker)  │
 │ model file        │        │ RPC server        │        │ RPC server        │
 │ chat + control    │◀──────────────────────────────────▶│                   │
 │ its own layers    │        │ a block of layers │        │ a block of layers │
 └───────────────────┘        └───────────────────┘        └───────────────────┘
        Any device can take either role · devices find each other over Bonjour/mDNS
```

Each device shares out the layers by its free memory. For each token, the host passes the data through every device's layers in order, then picks the next token.

Each app has three layers:

```
 ┌────────────────────────────────────────────────────────┐
 │ UI: React + TypeScript (app/src), the same everywhere  │
 ├────────────────────────────────────────────────────────┤
 │ App core: Rust, Tauri 2 (app/src-tauri)                │
 │ discovery · model downloads · roles (idle/worker/host) │
 ├────────────────────────────────────────────────────────┤
 │ Engine: llama.cpp + a thin C wrapper (engine/)         │
 │ inference · RPC server (worker) · RPC client (host)    │
 └────────────────────────────────────────────────────────┘
```

Everything runs inside the app process, which iOS requires because iOS apps can't start other programs.

### The three roles

| Role | What the device does |
|---|---|
| **Idle** | Nothing. It is visible to other devices but holds no part of a model. |
| **Worker** | Serves layers for a host. It runs llama.cpp's RPC server on port 50052 and waits. You can't chat on a worker. |
| **Host** | Where you chat. It needs the model file, splits the layers between itself and the workers you turned on, and runs every token through them. Loading a model in Chat makes a device the host. |

### Repository

| Path | What's there |
|---|---|
| `app/src/` | The UI: Devices, Models, Chat, the live split view |
| `app/src-tauri/src/` | Rust core: `discovery/` (mDNS + manual peers), `models/` (catalog, resumable verified downloads), `roles.rs` (idle/worker/host, memory guard), `commands.rs` |
| `app/src-tauri/plugins/` | `bonjour-ios` (Swift: Apple's Bonjour, which iOS needs for discovery), `multicast-android` (Kotlin: multicast lock, keep screen on) |
| `engine/` | Rust crate `dl-engine` over llama.cpp: `cpp/dl_engine.cpp` (host, worker, generation), `cpp/dl_stats.cpp` (each device's share, from llama.cpp's load log), `build.rs` (CMake per platform) |
| `engine/llama.cpp/` | llama.cpp as a git submodule, pinned |
| `patches/llama.cpp/` | Three small patches on top of the pinned llama.cpp, each explained in its [README](patches/llama.cpp/README.md) |
| `scripts/` | `fetch-model.sh`, `build-llama-cli.sh` (llama.cpp's command-line tools, for tests), `cli-split-check.sh` |
| `docs/evidence/` | What was tested on real devices, with logs and screenshots |

## Prerequisites

Built and tested on an Apple silicon Mac (macOS 26, Xcode 26.6). The Mac builds all three platforms.

| Tool | Version used | Needed for |
|---|---|---|
| Xcode + command-line tools | 26.6 | macOS and iOS |
| Rust (via [rustup](https://rustup.rs)) | 1.97 | everything |
| Node.js + npm | 20 | the UI |
| CMake | 4.4 (3.28 or newer) | llama.cpp |
| Android Studio: SDK, NDK `27.2.12479018` | | Android only |
| JDK | 17 | Android only |

```sh
# Rust targets
rustup target add aarch64-apple-ios                  # iPhone
rustup target add aarch64-linux-android              # Android (arm64)
```

Use rustup's Rust, not Homebrew's. If both are installed, rustup's `~/.cargo/bin` must come first on `PATH`, because Homebrew's Rust has no iOS standard library.

For Android, set these (for example in `~/.zshrc`):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
```

## Build and run

```sh
git clone --recursive https://github.com/ashiq-b/distributed-llm-app.git
cd distributed-llm-app/app
npm ci
```

`--recursive` fetches llama.cpp. If you cloned without it, run `git submodule update --init` in the repo root. The first build of each platform compiles llama.cpp and takes a few minutes. The llama.cpp patches are applied automatically.

### macOS

```sh
npm run tauri dev          # run it now, with live reload of the UI
npm run tauri build        # release build: the .app and a .dmg
```

The release build lands in the repo root's `target/` (the repo is a Cargo workspace): `target/release/bundle/macos/DistLLM.app` and `target/release/bundle/dmg/`. If macOS asks to allow local network access or incoming connections, allow it, or other devices can't find or use this Mac.

### iOS (iPhone)

A free Apple account works. Before the first build:

1. In Xcode, sign in with your Apple ID (Settings → Accounts). This creates your free "Personal Team".
2. In `app/src-tauri/tauri.conf.json`, set `bundle.iOS.developmentTeam` to your team ID (Xcode → Settings → Accounts → your team, or the 10-character ID in any provisioning error). The repo has the maintainer's.
3. If Xcode says the bundle ID `com.distllm.app` is not available, change `identifier` in the same file to something of your own, such as `com.yourname.distllm`.
4. On the iPhone, turn on Developer Mode (Settings → Privacy & Security → Developer Mode) and connect it to the Mac by cable once.

Then:

```sh
npm run tauri ios dev                     # build, install and run on the connected iPhone (choose it when asked)
# or a standalone build, then install it:
npm run tauri ios build -- --target aarch64 --export-method debugging
xcrun devicectl list devices              # find your iPhone's identifier
xcrun devicectl device install app --device <identifier> <unzipped .ipa>/Payload/DistLLM.app
```

`npm run tauri ios build` writes `src-tauri/gen/apple/build/arm64/DistLLM.ipa`. An `.ipa` is a zip: unzip it and install the `Payload/DistLLM.app` inside.

On the first launch:
- **Trust the developer:** Settings → General → VPN & Device Management → your Apple ID → Trust.
- **Allow Local Network** when iOS asks. Without it the iPhone can't see or reach other devices.

**Apps signed with a free account stop opening after 7 days.** Build and install again to renew it. A paid Apple Developer account extends this to a year.

### Android

```sh
npm run tauri android build -- --target aarch64 --apk --debug
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Android 9 (API 28) or newer, arm64. Android has no Metal, so llama.cpp runs on the CPU there.

For a signed release APK, create a keystore once (keep it outside the repo, and keep it safe: updates must be signed with the same key), then point `app/src-tauri/gen/android/keystore.properties` at it. That file is gitignored.

```sh
keytool -genkeypair -keystore ~/.android/distllm-release.jks -alias distllm -keyalg RSA -keysize 2048 -validity 10000
cat > src-tauri/gen/android/keystore.properties <<EOF
password=<the keystore password>
keyAlias=distllm
storeFile=$HOME/.android/distllm-release.jks
EOF
npm run tauri android build -- --target aarch64 --apk
# → src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Without `keystore.properties` the release APK is built unsigned and Android won't install it. An APK signed with a different key (for example a debug build) must be uninstalled first.

### Tests

```sh
cd app && npm test                         # UI (Vitest)
cargo test -p distllm-app                  # app core (from the repo root)
cargo test -p dl-engine                    # engine; the model tests are skipped unless DL_TEST_MODEL is set
```

For the engine's full tests, build llama.cpp's own RPC server and point the tests at a model:

```sh
scripts/build-llama-cli.sh                 # engine/build-cli/bin/ggml-rpc-server, llama-cli, …
scripts/fetch-model.sh qwen3.5-0.8b        # into models/, checksum verified
DL_TEST_MODEL=$PWD/models/Qwen3.5-0.8B-Q8_0.gguf cargo test -p dl-engine
```

## Models

Downloaded inside the app (Models screen), once on each device. Downloads resume after a dropped connection and are checked against the SHA-256 in the catalog before the model is offered as ready. The catalog is [`app/src-tauri/src/models/catalog.json`](app/src-tauri/src/models/catalog.json).

| Model | Quantisation | Download | Free memory needed (all devices together) |
|---|---|---|---|
| [LFM3 1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF) (Liquid AI) | Q4_K_M | 1.10 GB | 1,300 MiB |
| [Qwen3.5 2B](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF) (Qwen) | Q4_K_M | 1.28 GB | 1,600 MiB |
| [Qwen3.5 0.8B](https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF) (Qwen) | Q8_0 | 0.83 GB | 1,100 MiB |

Every device in a split needs its own copy of the model. A worker serves its layers from its own file, so loading sends almost no weights over Wi‑Fi.

## Demo

On one Wi‑Fi network, with the app on an iPhone and a Mac, and the same model downloaded on both:

1. **Mac:** open DistLLM. In Devices, set **This device** to **Worker**. It shows "Serving layers at 0.0.0.0:50052".
2. **iPhone:** open DistLLM. The Mac appears under **On this Wi‑Fi** within a few seconds, with its free memory. Turn on its switch.
3. **iPhone:** in **Chat**, pick the model and tap **Load**. The header reads "On <your Mac's name> and this device".
4. Tap **How it's split**: each device's layers and memory, as llama.cpp reported them.
5. Ask something. The answer streams in, with tokens per second underneath.
6. **Prove the Mac is doing work:** ask for something long, and while it answers, quit DistLLM on the Mac. The iPhone stops with "A device dropped out", keeps the conversation, and offers **Reconnect** once the Mac is a worker again.
7. **Swap roles:** Unload on the iPhone and set it to Worker. On the Mac, set it to Idle, turn the iPhone on, and load from the Mac's Chat.

Android joins the same way, as a worker or as the host.

## What has been verified

Each step was tested on real devices, and recorded with logs and screenshots in [`docs/evidence/`](docs/evidence/). The full acceptance checklist is [`docs/test-checklist.md`](docs/test-checklist.md).

| | Evidence |
|---|---|
| Each catalog model splits correctly over llama.cpp RPC (command line) | [0.2](docs/evidence/0.2-cli-split.md) |
| iPhone hosts with the Mac as worker, and the Mac hosts with the iPhone as worker | [2.4](docs/evidence/2.4-p0-split.md), [3.4](docs/evidence/3.4-roles.md) |
| A worker quitting mid-answer gives the host a clear error, and the app stays open | [3.4](docs/evidence/3.4-roles.md), [4.4](docs/evidence/4.4-chat.md) |
| Each device's layers and memory are read from llama.cpp's own load report | [4.5](docs/evidence/4.5-split-view.md) |
| Downloads survive a lost network and are checksum-verified | [2.3](docs/evidence/2.3-downloads.md) |
| Android as worker and as host, and iPhone + Mac + Android in one split | [5.1](docs/evidence/5.1-android-worker.md), [5.2](docs/evidence/5.2-three-device-split.md) |

Android has so far been tested on the Android emulator (arm64, Android 14), not on a phone.

## Limitations

- **Trusted networks only.** llama.cpp's RPC has no authentication or encryption. While a device is a worker, anyone on the same network can connect to port 50052 and use it, and the traffic can be read. Use Worker only on a network you trust, such as your home Wi‑Fi, never on public Wi‑Fi.
- **Local network only.** No internet relay. All devices must be on the same Wi‑Fi, and that network must let devices talk to each other (see client isolation below).
- **Slower than one device** for any model that fits on one device (see above).
- **Same app version everywhere.** Devices with a different app version or llama.cpp RPC version are shown as incompatible and can't be chosen.
- **iOS:**
  - The app must stay open in the foreground while it works. iOS suspends networking for background apps. The screen is kept on while the iPhone is a worker or host.
  - Builds signed with a free Apple account must be reinstalled every 7 days.
  - Apps are limited to about 3 GB of memory with a free account, which all three catalog models fit within.
- **Desktop is macOS only for now.** Windows and Linux are possible with the same stack, but not built or tested.
- **Android** runs llama.cpp on the CPU, so as a host it is slower than an iPhone or Mac. It has been tested on the emulator only.

## Troubleshooting

| Problem | What to do |
|---|---|
| **The iPhone sees no devices**, or can't connect to one it sees | Settings → Privacy & Security → **Local Network** → turn on DistLLM. Then close and reopen the app. |
| **No device sees any other**, on a network where they're all connected | The network probably blocks traffic between devices ("client isolation" or "AP isolation", common on guest, office and hotel Wi‑Fi, and some mesh routers). Use a home network or a phone hotspot, or turn isolation off in the router. As a fallback, add the worker under **Add by address** with its IP and port (shown on the worker's Devices screen, e.g. `192.168.1.7:50052`). |
| **A device shows as incompatible** | Its app version or RPC protocol version differs. Install the same build on every device. |
| **"Doesn't fit"** and Load is disabled | The model needs more free memory than the devices you turned on have together. Turn on more workers, close other apps, or pick a smaller model. |
| **The Mac isn't found by others** | If the macOS firewall is on, allow DistLLM: System Settings → Network → Firewall → Options. Also check System Settings → Privacy & Security → Local Network. |
| **The iOS app won't open** after a week | The free signing expired. Build and install it again. |
| **iOS build fails on `aarch64-apple-ios` std** | Homebrew's Rust is first on `PATH`. Put `~/.cargo/bin` first. |
| **Android build: "set NDK_HOME"** | Set `NDK_HOME` (see Prerequisites). |
| **"A device dropped out"** mid-answer | A worker quit, slept, or lost Wi‑Fi. Make it a worker again, then tap **Reconnect**. |
