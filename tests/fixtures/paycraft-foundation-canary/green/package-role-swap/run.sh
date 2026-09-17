#!/usr/bin/env bash
# AC-6 — a paywall bound to a package ROLE keeps resolving after the underlying SKU is swapped.
#
# This is the entire justification for the Offering → Package → Product indirection. If the paywall
# named the SKU, swapping products would mean editing every paywall that referenced it; bound to
# $rc_monthly, the swap is invisible to the paywall. The assertion is therefore not "the tables
# exist" but "the same package id resolves the NEW sku with zero paywall edits".
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/db.sh"
require_db || exit $?
T=11111111-1111-1111-1111-111111111111
trap 'drop_tenant "$T"' EXIT
drop_tenant "$T"; new_tenant "$T" ac6-tenant

psql_run >/dev/null <<SQL
SELECT tenant_products_upsert(jsonb_build_object(
  'tenant_id','$T','sku','pro_monthly_v1','type','subscription','interval','month',
  'display_name','Pro Monthly','base_price_cents',999,'base_currency','USD'));
SQL

# Bind it to a package exactly as the 088 backfill would.
psql_run >/dev/null <<SQL
DO \$\$
DECLARE off_id uuid; pkg_id uuid;
BEGIN
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current)
  VALUES ('$T','default','Default',true)
  ON CONFLICT (tenant_id, identifier) DO UPDATE SET updated_at = now() RETURNING id INTO off_id;
  INSERT INTO tenant_packages (offering_id, tenant_id, role_identifier, display_name)
  VALUES (off_id,'$T','\$rc_monthly','\$rc_monthly')
  ON CONFLICT (offering_id, role_identifier) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO pkg_id;
  UPDATE tenant_products SET package_id = pkg_id WHERE tenant_id = '$T' AND sku = 'pro_monthly_v1';
END \$\$;
SQL

PKG="$(psql_val "SELECT package_id FROM tenant_products WHERE tenant_id='$T' AND sku='pro_monthly_v1';")"
[ -n "$PKG" ] || { echo "AC-6 FAIL — product was not bound to a package" >&2; exit 1; }

# The merchant swaps the underlying SKU. No paywall edit accompanies this.
psql_run >/dev/null <<SQL
UPDATE tenant_products SET sku='pro_monthly_v2' WHERE tenant_id='$T' AND sku='pro_monthly_v1';
SQL

RESOLVED="$(psql_val "SELECT sku FROM tenant_products WHERE package_id='$PKG';")"
[ "$RESOLVED" = "pro_monthly_v2" ] \
  || { echo "AC-6 FAIL — role resolved '$RESOLVED', expected pro_monthly_v2" >&2; exit 1; }

ROLE="$(psql_val "SELECT role_identifier FROM tenant_packages WHERE id='$PKG';")"
[ "$ROLE" = '$rc_monthly' ] || { echo "AC-6 FAIL — role changed to '$ROLE'" >&2; exit 1; }

echo "AC-6 PASS — \$rc_monthly resolved pro_monthly_v2 after the swap, zero paywall edits"
