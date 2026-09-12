#!/usr/bin/env bash
# AC-29 — GET /api/products/[id] returns the REAL row, and refuses another tenant's row.
#
# The handler did not exist at all before this phase (F17), which is why the pricing page carried a
# fabricated fallback. Two assertions matter equally: the real values come back, AND a product
# belonging to a different tenant 404s rather than leaking — the query is tenant-scoped precisely
# so guessing a UUID is not an access path.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
. "$(cd "$(dirname "$0")/../../lib" && pwd)/dashboard.sh"
require_db || exit $?
require_dashboard || exit $?

T=66666666-6666-6666-6666-666666666666
O=77777777-7777-7777-7777-777777777777
COOKIE="$(cat "$PC_COOKIE_FILE")"

PID="$(psql_val "SELECT id FROM tenant_products WHERE tenant_id='$T' AND sku='pro_real';")"
[ -n "$PID" ] || { echo "AC-29 SKIP — canary product missing; seed tenant $T first" >&2; exit 2; }

code="$(curl -s -o /tmp/ac29.json -w '%{http_code}' -H "Cookie: $COOKIE" "$PC_DASH_URL/api/products/$PID")"
[ "$code" = "200" ] || { echo "AC-29 FAIL — HTTP $code, expected 200" >&2; exit 1; }
[ "$(jq -r .base_price_cents /tmp/ac29.json)" = "1499" ] \
  || { echo "AC-29 FAIL — base_price_cents $(jq -r .base_price_cents /tmp/ac29.json), expected 1499" >&2; exit 1; }
[ "$(jq -r .display_name /tmp/ac29.json)" = "Real Pro" ] \
  || { echo "AC-29 FAIL — display_name not the real row" >&2; exit 1; }
[ "$(jq -r .base_price_cents /tmp/ac29.json)" != "999" ] \
  || { echo "AC-29 FAIL — returned the retired stub price" >&2; exit 1; }

OPID="$(psql_val "SELECT id FROM tenant_products WHERE tenant_id='$O' LIMIT 1;")"
if [ -n "$OPID" ]; then
  ocode="$(curl -s -o /tmp/ac29-other.json -w '%{http_code}' -H "Cookie: $COOKIE" "$PC_DASH_URL/api/products/$OPID")"
  [ "$ocode" = "404" ] || { echo "AC-29 FAIL — cross-tenant read returned HTTP $ocode, expected 404" >&2; exit 1; }
  grep -q 'Someone Elses Product' /tmp/ac29-other.json \
    && { echo "AC-29 FAIL — cross-tenant response leaked another tenant's product" >&2; exit 1; }
fi
echo "AC-29 PASS — HTTP 200 with the real row (1499 / Real Pro); cross-tenant read 404s"
