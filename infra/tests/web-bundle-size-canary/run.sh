#!/usr/bin/env bash
# Canary for infra/web-bundle-size.sh (budget 512 B here): red (2 KB of incompressible hex) must exit 1,
# green (one tiny module) must PASS, empty (no .mjs) must exit 2 — so an empty build can never pass.
# Run from the repo root: bash infra/tests/web-bundle-size-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../web-bundle-size.sh"; fail=0
bash "$GATE" --dist "$HERE/red/dist" --budget-bytes 512 > /dev/null 2>&1; rc=$?
[[ $rc -eq 1 ]] || { echo "red: expected exit 1, got $rc"; fail=1; }
out="$(bash "$GATE" --dist "$HERE/green/dist" --budget-bytes 512 2>&1)"; rc=$?
[[ $rc -eq 0 ]] && grep -q PASS <<<"$out" || { echo "green: expected PASS, got $rc: $out"; fail=1; }
bash "$GATE" --dist "$HERE/empty/dist" --budget-bytes 512 > /dev/null 2>&1; rc=$?
[[ $rc -eq 2 ]] || { echo "empty: expected exit 2, got $rc"; fail=1; }
[[ $fail -eq 0 ]] && echo "canary OK (red 1, green 0, empty 2)"
exit $fail
