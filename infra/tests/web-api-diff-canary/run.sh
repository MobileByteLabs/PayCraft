#!/usr/bin/env bash
# Canary for infra/web-api-diff.sh — red (an exported member removed), red-duplicate (a top-level export
# declared twice — the 3.0 initHook defect) and red-bare-import (an .mjs importing an npm package) must fail;
# green (one member added, relative imports only) must pass. Run from the repo root or anywhere: bash infra/tests/web-api-diff-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../web-api-diff.sh"; fail=0
for r in red red-duplicate red-bare-import; do
  if bash "$GATE" "$HERE/$r/base.d.mts" "$HERE/$r/current.d.mts" > /dev/null 2>&1; then
    echo "$r: exit 0 — the gate missed it"; fail=1; fi
done
out="$(bash "$GATE" "$HERE/green/base.d.mts" "$HERE/green/current.d.mts" 2>&1)" || { echo "green: rejected an added member"; echo "$out"; fail=1; }
grep -q "no removed/changed members" <<<"$out" || { echo "green: missing PASS line"; fail=1; }
[[ $fail -eq 0 ]] && echo "canary OK (3 red exit 1, green exit 0)"
exit $fail
