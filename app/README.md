# DistLLM app (Tauri 2)

React UI (`src/`) + Rust core (`src-tauri/`) over the `dl-engine` crate (`../engine`).

```bash
npm install
DL_MODELS_DIR=../models npm run tauri dev                 # run on macOS (dev)
npm run tauri build -- --debug --bundles app              # DistLLM.app in ../target/debug/bundle/macos
```

`DL_MODELS_DIR` points the app at already-downloaded models (development only); otherwise
models live in the app's data directory.
