#!/usr/bin/env bash
# Canary for infra/event-pii-check.sh (GOAL D10 — no personal data in paywall events; paycraft-attempt-observability
# AC-19 — nor in the attempt fields and timeline). green (the real shape, with attempt id + failure) must PASS;
# red-event (the event class gains `email`), red-ingest (the ingest stores `free_text`), red-failure (a `raw_email`
# rides beside the failure fields) and red-timeline (the attempt_events timeline gains `buyer_email`) must exit 1
# naming the field — at any layer, a field that is not on the allowlist is refused until someone reviews it.
# Run from the repo root: bash infra/tests/event-pii-canary/run.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; GATE="$HERE/../../event-pii-check.sh"; fail=0
files() {
  echo --event "$1/PayCraftEvent.kt" --contract "$1/PayCraftContract.kt" --ingest "$1/events.ts" \
    --table "$1/180.sql" --attempts "$1/210.sql"
}
out="$(bash "$GATE" $(files "$HERE/green") 2>&1)"; rc=$?
[[ $rc -eq 0 ]] && grep -q "PASS event pii" <<<"$out" || { echo "green: expected PASS, got $rc: $out"; fail=1; }
out="$(bash "$GATE" $(files "$HERE/red-event") 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && grep -q "email" <<<"$out" || { echo "red-event: expected exit 1 naming email, got $rc: $out"; fail=1; }
out="$(bash "$GATE" $(files "$HERE/red-ingest") 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && grep -q "free_text" <<<"$out" || { echo "red-ingest: expected exit 1 naming free_text, got $rc: $out"; fail=1; }
out="$(bash "$GATE" $(files "$HERE/red-failure") 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && grep -q "raw_email" <<<"$out" || { echo "red-failure: expected exit 1 naming raw_email, got $rc: $out"; fail=1; }
out="$(bash "$GATE" $(files "$HERE/red-timeline") 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && grep -q "buyer_email" <<<"$out" && grep -q "attempt_events" <<<"$out" ||
  { echo "red-timeline: expected exit 1 naming buyer_email in attempt_events, got $rc: $out"; fail=1; }
bash "$GATE" --event "$HERE/missing.kt" > /dev/null 2>&1; rc=$?
[[ $rc -eq 2 ]] || { echo "missing input: expected exit 2, got $rc"; fail=1; }
[[ $fail -eq 0 ]] && echo "canary OK (green 0, red-event 1, red-ingest 1, red-failure 1, red-timeline 1, missing 2)"
exit $fail
