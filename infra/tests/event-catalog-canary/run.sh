#!/usr/bin/env bash
# Canary for infra/event-catalog-check.sh — red uses a "paycraft_*" name that is not in the catalog and
# must fail; green uses only catalog names and must pass.
# Run from anywhere: bash infra/tests/event-catalog-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../event-catalog-check.sh"; fail=0
if out="$(bash "$GATE" --root "$HERE/red" 2>&1)"; then
  echo "red: exit 0 — gate missed paycraft_made_up (canary broken)"; fail=1
elif grep -q "paycraft_made_up" <<<"$out"; then echo "red exit 1"
else echo "red: failed without naming paycraft_made_up"; echo "$out"; fail=1; fi
if bash "$GATE" --root "$HERE/green" > /dev/null 2>&1; then echo "green exit 0"
else echo "green: rejected a correct tree"; bash "$GATE" --root "$HERE/green"; fail=1; fi
[[ $fail == 0 ]] && echo "canary OK"
exit $fail
