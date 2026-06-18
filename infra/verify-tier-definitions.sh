#!/usr/bin/env bash
#
# infra/verify-tier-definitions.sh
#
# Phase 1 T6 of paycraft-v2-production-readiness — verify that the three
# canonical tier rows (Free / Pro / Enterprise) seeded by migration 031 are
# present and unmodified in framework-supabase prod. Used by the G-1 gate
# + as a smoke check before /paycraft-deploy ship.
#
# Reads SUPABASE_DB_URL from env (or pulls from vault via the alias
# framework-supabase-db-url if --from-vault is passed).
#
# Exit codes:
#   0 — all 3 rows present with expected values; G-1 sub-check PASS
#   1 — missing rows or values drifted (lists the offenders)
#   2 — invocation error (missing psql, no DB URL, etc.)

set -euo pipefail

# Resolve framework root for vault helper.
# Walk up until we find session-resolve.sh — robust to depth changes
FW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [ "$FW_ROOT" != "/" ] && [ ! -f "$FW_ROOT/core/scripts/session-resolve.sh" ]; do
    FW_ROOT=$(dirname "$FW_ROOT")
done

DB_URL="${SUPABASE_DB_URL:-}"
FROM_VAULT=false

while [ $# -gt 0 ]; do
    case "$1" in
        --from-vault)  FROM_VAULT=true; shift ;;
        --db-url)      DB_URL="$2"; shift 2 ;;
        *)             echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

if $FROM_VAULT && [ -z "$DB_URL" ]; then
    if [ ! -x "${FW_ROOT}/core/scripts/secrets-get.sh" ]; then
        echo "❌ --from-vault requires framework's secrets-get.sh; not found at ${FW_ROOT}/core/scripts/secrets-get.sh" >&2
        exit 2
    fi
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT
    bash "${FW_ROOT}/core/scripts/secrets-get.sh" framework-supabase-db-url --to-file "$TMP" >/dev/null
    DB_URL=$(cat "$TMP")
fi

if [ -z "$DB_URL" ]; then
    echo "❌ SUPABASE_DB_URL not set. Pass --db-url '<url>' or --from-vault." >&2
    exit 2
fi

command -v psql >/dev/null 2>&1 || {
    echo "❌ psql not installed (apt install postgresql-client or brew install postgresql)" >&2
    exit 2
}

# Query the 3 canonical rows; compare against expected baseline.
#
# Expected per migration 031:
#   free       : max_subs=100, base_price_cents=0,    metered=0
#   pro        : max_subs=1000, base_price_cents=2900, metered=10
#   enterprise : max_subs=NULL (unlimited), base_price_cents=0, metered=0

ACTUAL=$(psql "$DB_URL" --no-align --tuples-only --field-separator='|' --command "
  SELECT tier_name, COALESCE(max_active_subscribers::text, 'NULL'),
         base_price_cents, metered_per_subscriber_cents
    FROM tier_definitions
   WHERE tier_name IN ('free', 'pro', 'enterprise')
   ORDER BY CASE tier_name WHEN 'free' THEN 1 WHEN 'pro' THEN 2 ELSE 3 END;
")

EXPECTED='free|100|0|0
pro|1000|2900|10
enterprise|NULL|0|0'

if [ "$ACTUAL" = "$EXPECTED" ]; then
    echo "✅ tier_definitions verify PASS — all 3 rows match expected baseline."
    echo "$ACTUAL" | sed 's/|/  /g; s/^/   /'
    exit 0
fi

cat <<EOF
❌ tier_definitions verify FAIL — drift detected.

Expected:
$(echo "$EXPECTED" | sed 's/|/  /g; s/^/   /')

Actual:
$(echo "$ACTUAL" | sed 's/|/  /g; s/^/   /')

To resolve:
  1. If the migration has not been applied: re-run \`supabase db push\` against
     framework-supabase.
  2. If someone updated the seed rows manually: revert to baseline OR add a
     new migration that documents the intended change (and update this script
     plus GOAL.md AC5 with the new expected values).

Per CLAUDE.md migration rules, never edit applied migrations — always append.
EOF
exit 1
