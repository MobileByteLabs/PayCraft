#!/usr/bin/env bash
# AC-8 RED — a ninth full copy must be REFUSED by the shape lint.
#
# The fixture migration is copied into a THROWAWAY tree rather than into the repo's real
# migrations dir. Writing a file into supabase/migrations to test a lint means a crashed run
# leaves a bogus migration on disk that a later `supabase db reset` would try to apply.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$(cd "$HERE/../../../../.." && pwd)/supabase/migrations"
GREEN="$HERE/../../green/upsert-composable/run.sh"

# Three variants, because the lint must refuse a REFORMATTED copy and not merely the canonical
# one. Variants 2 and 3 both passed the original line-oriented case-sensitive grep.
fail=0
for fx in 091_ninth_copy 092_uppercase_copy 093_wrapped_copy; do
  TMP="$(mktemp -d -t ac8-red-XXXXXX)"
  cp "$MIG"/089_tenant_products_upsert_compose.sql "$TMP/" 2>/dev/null || true
  cp "$HERE/fixture/$fx.sql" "$TMP/$fx.sql"
  if out="$(bash "$GREEN" "$TMP" 2>&1)"; then
    echo "AC-8-RED FAIL — $fx slipped through the shape lint" >&2
    printf '%s\n' "$out" >&2; fail=1
  elif ! printf '%s' "$out" | grep -q "$fx.sql"; then
    echo "AC-8-RED FAIL — $fx refused, but the offending migration was not named" >&2
    printf '%s\n' "$out" >&2; fail=1
  else
    echo "  refused: $fx"
  fi
  rm -rf "$TMP"
done
[ "$fail" -eq 0 ] || exit 1
echo "AC-8-RED PASS — shape lint refused all three copy variants (canonical, uppercase, wrapped)"
