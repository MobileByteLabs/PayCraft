#!/usr/bin/env bash
# AC-6/AC-7 — a trial product maps to the package for its CADENCE, not a slot of its own.
# Documented in 088; asserted here so the decision is enforced rather than merely written down.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=88888888-8888-8888-8888-888888888888
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" trial-tenant

psql_run >/dev/null <<SQL
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','t_month','type','trial','interval','month','display_name','TrialMonth','base_price_cents',0));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','t_none','type','trial','display_name','TrialNoCadence','base_price_cents',0));
UPDATE tenant_products SET package_id = NULL WHERE tenant_id='$T';
SQL
docker exec -i "$PC_DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -f /dev/stdin < ./supabase/migrations/088_offerings_packages.sql >/dev/null 2>&1 \
  || { echo "TRIAL FAIL — 088 did not re-apply" >&2; exit 1; }

R1="$(psql_val "SELECT p.role_identifier FROM tenant_products t JOIN tenant_packages p ON p.id=t.package_id WHERE t.tenant_id='$T' AND t.sku='t_month';")"
R2="$(psql_val "SELECT p.role_identifier FROM tenant_products t JOIN tenant_packages p ON p.id=t.package_id WHERE t.tenant_id='$T' AND t.sku='t_none';")"
[ "$R1" = '$rc_monthly' ] || { echo "TRIAL FAIL — trial+month mapped to '$R1', expected \$rc_monthly" >&2; exit 1; }
[ "$R2" = '$rc_custom' ]  || { echo "TRIAL FAIL — trial+no-cadence mapped to '$R2', expected \$rc_custom" >&2; exit 1; }
echo "TRIAL PASS — trial maps by cadence (\$rc_monthly) and falls to \$rc_custom without one"
