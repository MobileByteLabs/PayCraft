#!/usr/bin/env bash
# Canary for infra/web-ui-api-check.sh: the lazy UI module calls PayCraftWeb only through the members it
# declares in PayCraftWebApi.kt. red (the d.mts lost `claimOffer`) must exit 1 and name it; green must PASS.
# Run from the repo root: bash infra/tests/web-ui-api-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../web-ui-api-check.sh"; fail=0
out="$(bash "$GATE" --api "$HERE/api.kt" --dts "$HERE/red/paycraft-web.d.mts" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && grep -q claimOffer <<<"$out" || { echo "red: expected exit 1 naming claimOffer, got $rc: $out"; fail=1; }
out="$(bash "$GATE" --api "$HERE/api.kt" --dts "$HERE/green/paycraft-web.d.mts" 2>&1)"; rc=$?
[[ $rc -eq 0 ]] && grep -q PASS <<<"$out" || { echo "green: expected PASS, got $rc: $out"; fail=1; }
[[ $fail -eq 0 ]] && echo "canary OK (red 1, green 0)"
exit $fail
