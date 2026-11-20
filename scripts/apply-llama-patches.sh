#!/usr/bin/env bash
# Apply our documented patches (patches/llama.cpp/*.patch, in order) to the pinned llama.cpp
# submodule. Idempotent: the patched files are rebuilt from the pinned commit plus the whole
# stack in a scratch directory, and copied in only if they differ (so builds don't redo
# work). Later patches may touch lines near earlier ones, so patches are never checked
# one by one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/engine/llama.cpp"
PATCHES=("$ROOT"/patches/llama.cpp/*.patch)
[[ -e "${PATCHES[0]}" ]] || exit 0

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Files the patches touch, as of the pinned commit.
FILES=$(git -C "$SRC" apply --numstat "${PATCHES[@]}" | cut -f3 | sort -u)
for f in $FILES; do
  mkdir -p "$WORK/$(dirname "$f")"
  git -C "$SRC" show "HEAD:$f" > "$WORK/$f"
done

# Apply the stack there (a plain directory: git apply works like patch(1)).
for patch in "${PATCHES[@]}"; do
  (cd "$WORK" && git apply "$patch")
done

for f in $FILES; do
  if ! cmp -s "$WORK/$f" "$SRC/$f"; then
    cp "$WORK/$f" "$SRC/$f"
    echo "patched $f"
  fi
done
