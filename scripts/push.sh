#!/usr/bin/env bash
# Push the current branch as the repo account (ashiq-b), without changing the
# active gh account or storing the token anywhere.
set -euo pipefail
GH_TOKEN="$(gh auth token --user ashiq-b)"
export GH_TOKEN
git -c credential.helper= \
    -c credential.helper='!f() { echo username=ashiq-b; echo "password=$GH_TOKEN"; }; f' \
    push "$@"
