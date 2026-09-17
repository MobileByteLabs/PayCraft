#!/usr/bin/env bash
# AC-7 RED — a product the backfill cannot classify must ABORT 088, naming the row.
#
# The failure mode this guards against is the tempting one: map what you can, leave the rest with a
# null package_id, move on. Those nulls then look like cleanup debt to the next person. Refusing to
# finish is the only behaviour that guarantees a human looks at the row.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=22222222-2222-2222-2222-222222222222
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" ac7red-tenant

# Simulating the ACTUAL failure scenario. tenant_products_interval_check currently admits only
# {month, quarter, semiannual, year}, and every one of those has a CASE arm — so no *storable*
# value is unmappable today. The realistic regression is someone widening the constraint to add a
# cadence and not touching the backfill. That is reproduced here: widen the CHECK, insert a
# product using the new value, and require 088 to refuse rather than leave it unmapped.
#
# The constraint is restored by the trap regardless of outcome, so a failed run does not leave the
# local schema permissively altered.
restore_check() {
  # Verifies rather than assumes. The first version of this trap ran BEFORE the offending row was
  # deleted, so ADD CONSTRAINT failed against surviving data and the table was left without its
  # constraint — a canary that silently loosened the schema it was testing.
  psql_run >/dev/null 2>&1 <<SQL
ALTER TABLE tenant_products DROP CONSTRAINT IF EXISTS tenant_products_interval_check;
ALTER TABLE tenant_products ADD CONSTRAINT tenant_products_interval_check
  CHECK ((interval IS NULL) OR (interval = ANY (ARRAY['month','quarter','semiannual','year'])));
SQL
  local def
  def="$(psql_val "SELECT count(*) FROM pg_constraint WHERE conname='tenant_products_interval_check';")"
  [ "$def" = "1" ] || echo "WARNING — tenant_products_interval_check was NOT restored" >&2
}
trap 'drop_tenant "$T"; restore_check' EXIT

psql_run >/dev/null <<SQL
ALTER TABLE tenant_products DROP CONSTRAINT IF EXISTS tenant_products_interval_check;
ALTER TABLE tenant_products ADD CONSTRAINT tenant_products_interval_check
  CHECK ((interval IS NULL) OR (interval = ANY (ARRAY['month','quarter','semiannual','year','fortnight'])));
INSERT INTO tenant_products (id, tenant_id, sku, type, display_name, interval)
VALUES (gen_random_uuid(), '$T', 'weird_sku', 'subscription', 'Weird', 'fortnight');
SQL

err="$(docker exec -i "$PC_DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
        -f /dev/stdin < ./supabase/migrations/088_offerings_packages.sql 2>&1)"; rc=$?
[ "$rc" -ne 0 ] || { echo "AC-7-RED FAIL — 088 completed despite an unmappable product" >&2; exit 1; }
printf '%s' "$err" | grep -q 'refuses silent drop' \
  || { echo "AC-7-RED FAIL — aborted, but not with the named contract" >&2; printf '%s\n' "$err" >&2; exit 1; }
printf '%s' "$err" | grep -q 'fortnight' \
  || { echo "AC-7-RED FAIL — the error does not identify the offending row" >&2; printf '%s\n' "$err" >&2; exit 1; }
echo "AC-7-RED PASS — 088 aborted and named the unmappable row"
