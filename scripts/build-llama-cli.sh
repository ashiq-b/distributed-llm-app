#!/usr/bin/env bash
# Build llama.cpp's command-line tools for macOS (RPC + Metal enabled).
# Output: engine/build-cli/bin/{ggml-rpc-server,llama-cli,...}
# Used for command-line spikes and as the external RPC worker in engine tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/apply-llama-patches.sh"

cmake -S "$ROOT/engine/llama.cpp" -B "$ROOT/engine/build-cli" \
  -DGGML_RPC=ON \
  -DGGML_METAL=ON \
  -DLLAMA_CURL=OFF \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/engine/build-cli" -j "$(sysctl -n hw.ncpu)"
