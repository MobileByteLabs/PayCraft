#!/usr/bin/env bash
# Canary for infra/module-boundary-check.sh — each red tree breaks exactly one rule (MB-1..MB-4) and must
# fail; the green tree (UI-only cmp-paycraft, Compose-free core) must pass.
# Run from anywhere: bash infra/tests/module-boundary-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../module-boundary-check.sh"; fail=0; reds=0
for case in leftover-logic:MB-1 platform-in-ui:MB-2 compose-in-core:MB-3 compose-dep-in-core:MB-4 compose-plugin-in-core:MB-4; do
  dir="${case%%:*}"; want="${case##*:}"
  if out="$(bash "$GATE" --root "$HERE/red/$dir" 2>&1)"; then
    echo "red/$dir: exit 0 — gate missed $want (canary broken)"; fail=1
  elif grep -q "$want" <<<"$out"; then reds=$((reds + 1))
  else echo "red/$dir: failed without reporting $want"; echo "$out"; fail=1; fi
done
echo "$reds/5 red exit 1"
if bash "$GATE" --root "$HERE/green" > /dev/null 2>&1; then echo "green exit 0"; else echo "green: rejected a correct tree"; bash "$GATE" --root "$HERE/green"; fail=1; fi
exit $fail
