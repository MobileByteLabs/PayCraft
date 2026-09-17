#!/usr/bin/env bash
# AC-7 green — the 088 backfill maps every product and loses none.
#
# The count invariant is the point: a backfill that silently drops a merchant's product is far
# worse than one that fails, because nobody finds out until a customer cannot buy something. So
# this asserts per-tenant count parity pre-vs-post AND that every row came out with a package.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=55555555-5555-5555-5555-555555555555
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" ac7-tenant

# One product per mappable role, to prove the CASE arms all resolve.
psql_run >/dev/null <<SQL
-- One product per STORABLE interval. tenant_products_interval_check admits exactly
-- {month, quarter, semiannual, year} or NULL — the ISO-8601 codes an earlier draft of this
-- fixture used cannot be inserted at all, which is what exposed the backfill mapping bug.
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_life','type','lifetime','display_name','Life','base_price_cents',9999));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_year','type','subscription','interval','year','display_name','Year','base_price_cents',4999));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_semi','type','subscription','interval','semiannual','display_name','Semi','base_price_cents',2999));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_qtr','type','subscription','interval','quarter','display_name','Qtr','base_price_cents',1999));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_month','type','subscription','interval','month','display_name','Month','base_price_cents',999));
-- A non-recurring product: NULL interval maps to the merchant-custom slot, not an abort.
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','s_once','type','subscription','display_name','OneOff','base_price_cents',499));
SQL
BEFORE="$(psql_val "SELECT count(*) FROM tenant_products WHERE tenant_id='$T';")"

# Null the package ids so the backfill has real work, then re-run its exact logic.
psql_run >/dev/null <<SQL
UPDATE tenant_products SET package_id = NULL WHERE tenant_id='$T';
SQL
docker exec -i "$PC_DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -f /dev/stdin < ./supabase/migrations/088_offerings_packages.sql >/dev/null 2>&1 \
  || { echo "AC-7 FAIL — 088 did not re-apply cleanly" >&2; exit 1; }

AFTER="$(psql_val "SELECT count(*) FROM tenant_products WHERE tenant_id='$T';")"
UNMAPPED="$(psql_val "SELECT count(*) FROM tenant_products WHERE tenant_id='$T' AND package_id IS NULL;")"
ROLES="$(psql_val "SELECT count(DISTINCT role_identifier) FROM tenant_packages WHERE tenant_id='$T';")"

[ "$BEFORE" = "$AFTER" ] || { echo "AC-7 FAIL — count $BEFORE → $AFTER (products lost)" >&2; exit 1; }
[ "$UNMAPPED" = "0" ]    || { echo "AC-7 FAIL — $UNMAPPED product(s) left unmapped" >&2; exit 1; }
[ "$ROLES" = "6" ]       || { echo "AC-7 FAIL — expected 6 distinct roles, got $ROLES" >&2; exit 1; }
echo "AC-7 PASS — $AFTER products preserved, 0 unmapped, 6 distinct roles"
