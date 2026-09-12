#!/usr/bin/env bash
# AC-9 (D6) — a merchant disabling a lifetime product must NOT revoke the entitlement someone
# already paid for. This is the canary for the promise the dashboard copy makes; without it that
# copy is just a claim.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=33333333-3333-3333-3333-333333333333
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" ac9-tenant

psql_run >/dev/null <<SQL
SELECT tenant_products_upsert(jsonb_build_object(
  'tenant_id','$T','sku','pro_lifetime','type','lifetime',
  'display_name','Lifetime Pro','base_price_cents',9999,'base_currency','USD'));
INSERT INTO entitlement_records
  (app_user_id, tenant_id, provider, product_id, stable_txn_id,
   canonical_state, expires_at, latest_event_ts)
VALUES ('user_ac9','$T','app_store','pro_lifetime','tx_ac9_lifetime','active', NULL, now())
ON CONFLICT (provider, stable_txn_id) DO NOTHING;
SQL

BEFORE="$(psql_val "SELECT public.is_premium_by_app_user('user_ac9');")"
[ "$BEFORE" = "t" ] || { echo "AC-9 FAIL — user was not premium before the toggle" >&2; exit 1; }

# The merchant hides the product from the paywall.
psql_run >/dev/null <<SQL
UPDATE tenant_products SET active = false WHERE tenant_id='$T' AND sku='pro_lifetime';
SQL

AFTER="$(psql_val "SELECT public.is_premium_by_app_user('user_ac9');")"
[ "$AFTER" = "t" ] \
  || { echo "AC-9 FAIL — disabling the product REVOKED a paid entitlement (D6 violated)" >&2; exit 1; }

# And confirm the product really is hidden, so this is not passing because the toggle did nothing.
VISIBLE="$(psql_val "SELECT count(*) FROM tenant_products_list('$T') WHERE sku='pro_lifetime';")"
[ "$VISIBLE" = "0" ] \
  || { echo "AC-9 FAIL — product still visible after disable; the toggle had no effect" >&2; exit 1; }

echo "AC-9 PASS — product hidden from the paywall, entitlement retained (disable ≠ revoke)"
