#!/usr/bin/env bash
# Canary for infra/attempt-cron-check.sh (paycraft-attempt-observability AC-8 + AC-18). Each red fixture must exit 1
# and NAME what is wrong; green (four schedules, one insights job, a dispatcher that calls attempt-insights) must
# exit 0. Reads fixture migrations only — no database needed.
#   red            the weekly paycraft_attempt_insights schedule missing (only present as a comment)
#   red-dispatch   the schedule exists but attempt_insights_dispatch() never calls the attempt-insights function
#   red-duplicate  a second weekly insights schedule beside 211's (every tenant summarised and billed twice)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../attempt-cron-check.sh"; fail=0
[[ -f "$GATE" ]] || { echo "canary FAIL: gate $GATE does not exist"; exit 1; }

expect_red() { # <fixture> <substring the failure must name>
  local out code
  out="$(bash "$GATE" --migrations "$HERE/$1/migrations" 2>&1)"; code=$?
  if [[ $code -eq 1 && "$out" == *"$2"* ]]; then
    echo "$1: exit 1 naming $2 (expected)"
  else
    echo "$1: exit $code (UNEXPECTED) — $out"; fail=1
  fi
}

expect_red red paycraft_attempt_insights
expect_red red-dispatch attempt_insights_dispatch
expect_red red-duplicate attempt-insights-weekly

gout="$(bash "$GATE" --migrations "$HERE/green/migrations" 2>&1)"; g=$?
if [[ $g -eq 0 ]]; then echo "green: exit 0 (expected)"
else echo "green: exit $g (UNEXPECTED) — $gout"; fail=1; fi

if [[ $fail -eq 0 ]]; then echo "canary OK (3 reds exit 1, green exit 0)"; else echo "canary FAIL"; fi
exit $fail
