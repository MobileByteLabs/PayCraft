#!/usr/bin/env bash
# AC-11 — a disabled product is absent from the products the /config endpoint serves.
#
# Asserted at tenant_products_list, which is where the filter actually lives (migration 028) and
# what supabase/functions/config/index.ts calls. Asserting against the RPC rather than a mocked
# HTTP body means this cannot pass while the real read path is broken.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=44444444-4444-4444-4444-444444444444
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" ac11-tenant

psql_run >/dev/null <<SQL
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','visible_sku','type','subscription','interval','month','display_name','Visible','base_price_cents',999));
SELECT tenant_products_upsert(jsonb_build_object('tenant_id','$T','sku','hidden_sku','type','subscription','interval','month','display_name','Hidden','base_price_cents',1999,'active',false));
SQL

HID="$(psql_val "SELECT count(*) FROM tenant_products_list('$T') WHERE sku='hidden_sku';")"
VIS="$(psql_val "SELECT count(*) FROM tenant_products_list('$T') WHERE sku='visible_sku';")"
[ "$HID" = "0" ] || { echo "AC-11 FAIL — disabled sku present in the config projection" >&2; exit 1; }
[ "$VIS" = "1" ] || { echo "AC-11 FAIL — active sku missing; the filter is over-broad" >&2; exit 1; }
echo "AC-11 PASS — disabled sku absent, active sku present"
