#!/usr/bin/env bash
# Canary for infra/api-split-diff.sh. Every red case must fail:
#   removed-member          a non-D5 member disappears
#   target-narrowed         a declaration survives only on wasmJs (was iOS + JS + wasmJs)
#   other-owner-mentions-d5 another class's member that merely mentions BillingBenefit is removed
#   d11-other-member        a D11 class loses a member that is NOT its constructor / copy (getConflict)
# green (only BillingBenefit's own members change, BenefitIcon added, a Compose $stable field dropped, and a
# D11 data class's constructor + copy gain the device-limit fields)
# must pass. Run from anywhere: bash infra/tests/api-split-diff-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../api-split-diff.sh"; fail=0; reds=0
for d in "$HERE"/red/*/; do
  name="$(basename "$d")"
  if bash "$GATE" --baseline "$d/baseline" --current "$d/current" > /dev/null 2>&1; then
    echo "red/$name: exit 0 — gate missed it (canary broken)"; fail=1
  else reds=$((reds + 1)); fi
done
echo "red: $reds/$(ls -d "$HERE"/red/*/ | wc -l | tr -d ' ') exit 1 OK"
if bash "$GATE" --baseline "$HERE/green/baseline" --current "$HERE/green/current" > /dev/null 2>&1; then
  echo "green: exit 0 OK"
else echo "green: exit 1 — gate rejected an allowed D5 change"; bash "$GATE" --baseline "$HERE/green/baseline" --current "$HERE/green/current"; fail=1; fi
exit $fail
