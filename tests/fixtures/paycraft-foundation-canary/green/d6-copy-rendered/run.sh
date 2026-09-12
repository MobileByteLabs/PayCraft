#!/usr/bin/env bash
# T8 / AC-9 affordance — the D6 guarantee is RENDERED beside the active toggle, not merely typed
# into the source. Migration 090 makes the promise true; this makes it visible where the decision
# to disable is actually taken.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/dashboard.sh"
require_dashboard || exit $?
RUNNER="$(find_web_debug_runner "$(cd "$(dirname "$0")" && pwd)")" \
  || { echo "SKIP — web-debug runner not found walking up from $(dirname "$0")" >&2; exit 2; }
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
PID="$(psql_val "SELECT id FROM tenant_products WHERE tenant_id='66666666-6666-6666-6666-666666666666' AND sku='pro_real';" 2>/dev/null)"
[ -n "$PID" ] || { echo "SKIP — canary product missing; run tests/fixtures/paycraft-foundation-canary/seed.sh" >&2; exit 2; }
export PC_TEST_PRODUCT_ID="$PID"
exec bash "$RUNNER" run "$(cd "$(dirname "$0")" && pwd)/check.ts"
