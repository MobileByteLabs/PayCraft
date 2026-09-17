#!/usr/bin/env bash
# RED — an anonymous PostgREST caller must NOT be able to write another tenant's product.
#
# Before migration 091 this succeeded and returned a fresh uuid. The guard added in 084 reads
# `IF auth.uid() IS NOT NULL AND NOT EXISTS (tenant_admins match)`, which short-circuits to "trusted"
# whenever auth.uid() is NULL — intended for the service-role backend, but anon's uid is NULL too.
# 084's header justified the shape with "anon can't reach these RPCs (granted to `authenticated`
# only)", which was never true: PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION.
#
# Exercised over HTTP with the PUBLISHABLE anon key — the exact request an attacker holding a
# shipped client key would send — rather than via SET ROLE, which additionally triggers a SIGSEGV
# in this Supabase postgres image.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?

ENVFILE="${PC_LOCAL_ENV_FILE:-$(cat /tmp/pc-env-path 2>/dev/null || true)}"
[ -n "$ENVFILE" ] && [ -s "$ENVFILE" ] \
  || { echo "SKIP — no local-stack env file (supabase status -o env > FILE; echo FILE > /tmp/pc-env-path)" >&2; exit 2; }
eval "$(grep -E '^(API_URL|ANON_KEY)=' "$ENVFILE" | sed 's/^/export /')"
case "${API_URL:-}" in http://127.0.0.1:*) : ;; *) echo "SKIP — API_URL is not local" >&2; exit 2 ;; esac

T=66666666-6666-6666-6666-666666666666
SKU=anon_rpc_canary
body="{\"p_row\":{\"tenant_id\":\"$T\",\"sku\":\"$SKU\",\"type\":\"subscription\",\"interval\":\"month\",\"display_name\":\"Injected\",\"base_price_cents\":1}}"
code="$(curl -s -o /tmp/anon-rpc-canary.json -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/tenant_products_upsert" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d "$body")"

rows="$(psql_val "SELECT count(*) FROM tenant_products WHERE sku='$SKU';")"
psql_run >/dev/null 2>&1 <<SQL
DELETE FROM tenant_products WHERE sku='$SKU';
SQL

case "$code" in
  401|403) : ;;
  *) echo "RED FAIL — anon RPC returned HTTP $code, expected 401/403" >&2
     head -c 200 /tmp/anon-rpc-canary.json >&2; echo >&2; exit 1 ;;
esac
grep -q 'permission denied for function' /tmp/anon-rpc-canary.json \
  || { echo "RED FAIL — refused, but not by a function-level permission check" >&2; exit 1; }
[ "$rows" = "0" ] || { echo "RED FAIL — anon wrote $rows row(s) into tenant $T" >&2; exit 1; }
echo "RED PASS — anon RPC refused (HTTP $code, permission denied), zero rows written"
