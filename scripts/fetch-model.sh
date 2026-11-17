#!/usr/bin/env bash
# Download a catalog model into models/ and verify its SHA-256.
# Usage: scripts/fetch-model.sh <model-id>      e.g. scripts/fetch-model.sh qwen3.5-0.8b
# Resumes partial downloads. A checksum mismatch deletes the file and exits 1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG="${DL_CATALOG:-$ROOT/app/src-tauri/src/models/catalog.json}"   # override for tests
ID="${1:?usage: fetch-model.sh <model-id>}"

read -r URL FILE SHA < <(python3 -I -c '
import json, sys
for m in json.load(open(sys.argv[1])):
    if m["id"] == sys.argv[2]:
        print(m["url"], m["file"], m["sha256"]); break
else:
    sys.exit("unknown model id: " + sys.argv[2])
' "$CATALOG" "$ID")

mkdir -p "$ROOT/models"
DEST="$ROOT/models/$FILE"
PART="$DEST.part"

if [[ -f "$DEST" ]]; then
  echo "already downloaded: $DEST (re-verifying)"
else
  echo "downloading $ID -> $DEST"
  curl -fL --retry 5 --retry-delay 3 -C - -o "$PART" "$URL"
  mv "$PART" "$DEST"
fi

ACTUAL="$(shasum -a 256 "$DEST" | awk '{print $1}')"
if [[ "$ACTUAL" != "$SHA" ]]; then
  echo "checksum mismatch for $FILE: expected $SHA, got $ACTUAL" >&2
  rm -f "$DEST"
  exit 1
fi
echo "ok: $FILE sha256 verified"
