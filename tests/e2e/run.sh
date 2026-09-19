#!/usr/bin/env bash
# tests/e2e/run.sh — the whole end-to-end suite, server and dashboard, against the LOCAL stack.
#
# Usage:
#   tests/e2e/run.sh              # server + dashboard
#   tests/e2e/run.sh --server     # deno server-layer suites only
#   tests/e2e/run.sh --dashboard  # playwright dashboard suites only
#
# Preconditions, checked rather than assumed — a suite that "passes" because the stack is down is the
# same vacuous green this rule exists to eliminate:
#   supabase start            (Postgres + Kong)
#   supabase functions serve  (edge functions; `supabase start` alone does NOT serve them)
#   npm --prefix dashboard run dev   (only for --dashboard; playwright will reuse a running server)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

WHAT="${1:---all}"
DB_CONTAINER="${PAYCRAFT_DB_CONTAINER:-supabase_db_PayCraft}"
rc=0

preflight() {
  if ! docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "SELECT 1" >/dev/null 2>&1; then
    echo "✗ local Postgres unreachable (container $DB_CONTAINER). Run: supabase start" >&2
    exit 2
  fi
  if ! curl -sf -o /dev/null "http://127.0.0.1:54321/functions/v1/config" \
     && ! curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:54321/functions/v1/config" | grep -qE '^[45]'; then
    # A 4xx from /config still proves something is SERVING; only a connection failure is fatal.
    echo "✗ edge functions not serving at 127.0.0.1:54321. Run: supabase functions serve" >&2
    exit 2
  fi
  # Pending migrations mean the suite would assert against a schema nobody deployed.
  local pending
  pending="$(supabase migration list --local 2>/dev/null | awk 'NR>2 && $1 ~ /^[0-9]+$/ && $2 == "" {n++} END {print n+0}')"
  if [ "${pending:-0}" -gt 0 ]; then
    echo "⚠ ${pending} migration(s) not applied locally — run: supabase migration up --local" >&2
  fi
}

run_server() {
  # Sweep tenants left by a crashed run. A test that dies BEFORE its try/finally (a bad seed, an
  # interrupted run) leaks its tenant; 37 had accumulated before this ran, and they then showed up
  # in every migration backfill as if they were real apps.
  deno eval --allow-net --allow-run --allow-env \
    'const m = await import("./tests/e2e/harness.ts"); const n = await m.dropAllE2ETenants(); if (n) console.log(`swept ${n} leftover e2e tenant(s)`)' \
    2>/dev/null || true

  echo "── server layer (deno, real Postgres + real edge functions) ──"
  deno test --allow-net --allow-run --allow-env tests/e2e/ || rc=1
}

run_dashboard() {
  echo "── dashboard (playwright, real browser + real routes) ──"
  ( cd dashboard && npx playwright test --reporter=line ) || rc=1
}

preflight
case "$WHAT" in
  --server)    run_server ;;
  --dashboard) run_dashboard ;;
  *)           run_server; run_dashboard ;;
esac

[ "$rc" -eq 0 ] && echo "e2e: PASS" || echo "e2e: FAIL"
exit "$rc"
