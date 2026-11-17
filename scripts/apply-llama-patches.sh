#!/usr/bin/env bash
# Apply our documented patches (patches/llama.cpp/*.patch) to the pinned llama.cpp
# submodule. Idempotent: already-applied patches are skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/engine/llama.cpp"
for patch in "$ROOT"/patches/llama.cpp/*.patch; do
  [[ -e "$patch" ]] || continue
  if git -C "$SRC" apply --reverse --check "$patch" 2>/dev/null; then
    continue                                   # already applied
  fi
  git -C "$SRC" apply "$patch"
  echo "applied $(basename "$patch")"
done
