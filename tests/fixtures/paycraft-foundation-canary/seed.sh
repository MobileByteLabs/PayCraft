#!/usr/bin/env bash
# Idempotent seed for the canaries that need pre-existing tenants (AC-29/AC-30 and the anon-RPC
# RED case). Without this the dashboard canaries depend on whatever an operator happened to create
# by hand — so a `supabase db reset` silently turned them into SKIPs that read like "dependency
# not running" rather than "fixture missing".
set -uo pipefail
. "$(cd "$(dirname "$0")/lib" && pwd)/db.sh"
require_db || exit $?

T=66666666-6666-6666-6666-666666666666
O=77777777-7777-7777-7777-777777777777

psql_run >/dev/null <<SQL
INSERT INTO tenants (id, name, api_key_test, api_key_live, owner_email)
VALUES ('$T','ac29-tenant','canary-ac29-t','canary-ac29-l','canary@local.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tenants (id, name, api_key_test, api_key_live, owner_email)
VALUES ('$O','other-tenant','canary-other-t','canary-other-l','other@local.test')
ON CONFLICT (id) DO NOTHING;
SQL

# The id is resolved and passed back in, because tenant_products_upsert conflicts on (id) while
# the table ALSO carries a unique (tenant_id, sku). Calling it a second time with the same SKU and
# no id therefore raises a unique violation rather than updating — so the "upsert" is not idempotent
# by natural key. Pre-existing (this ON CONFLICT shape dates to 028) and out of scope here, but it
# is why this seed cannot simply call the RPC twice.
seed_product() { # seed_product <tenant> <sku> <name> <cents>
  local existing
  existing="$(psql_val "SELECT id FROM tenant_products WHERE tenant_id='$1' AND sku='$2';")"
  psql_run >/dev/null <<SQL
SELECT tenant_products_upsert(jsonb_build_object(
  'id', $( [ -n "$existing" ] && echo "'$existing'" || echo "''" ),
  'tenant_id','$1','sku','$2','type','subscription','interval','month',
  'display_name','$3','base_price_cents',$4,'base_currency','USD'));
SQL
}
seed_product "$T" pro_real       "Real Pro"              1499
seed_product "$O" secret_product "Someone Elses Product" 7777

PID="$(psql_val "SELECT id FROM tenant_products WHERE tenant_id='$T' AND sku='pro_real';")"
echo "$PID" > /tmp/pc-ac29-pid
echo "seeded: tenant $T product $PID (Real Pro / 1499), plus cross-tenant fixture in $O"
echo "note: the browser canaries also need a session cookie at \${PC_COOKIE_FILE:-/tmp/pc-cookie.txt}"
