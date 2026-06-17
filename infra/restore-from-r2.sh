#!/usr/bin/env bash
#
# infra/restore-from-r2.sh
#
# Phase 3 of paycraft-v2-production-readiness — automated restore from
# Cloudflare R2 into a fresh ephemeral Supabase project.
#
# Usage:
#   ./infra/restore-from-r2.sh [YYYY/MM/DD]
#
# Requires env vars (sourced from vault or shell):
#   R2_ACCESS_KEY_ID
#   R2_SECRET_ACCESS_KEY
#   R2_ENDPOINT_URL
#   TARGET_DB_URL          (postgres URL of the DB to restore INTO; NEVER prod)
#
# RPO=24h, RTO=4h. See docs/DR_RUNBOOK.md for full procedure.

set -euo pipefail

PREFIX="${1:-$(date -u +%Y/%m/%d)}"
BUCKET="paycraft-backups"

for v in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT_URL TARGET_DB_URL; do
  if [ -z "${!v:-}" ]; then
    echo "❌ env var ${v} required" >&2
    exit 1
  fi
done

# Guardrail: refuse to restore into framework-supabase (prod) by accident.
if echo "${TARGET_DB_URL}" | grep -qi "mlwfgytjxlqyfxcgpysm"; then
  echo "❌ TARGET_DB_URL points at framework-supabase — refusing prod restore" >&2
  echo "   To restore into prod, pass --confirm-prod-restore=YES (not yet implemented)" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION=auto

echo "▶ Locating latest dump under prefix ${PREFIX}…"
LATEST=$(aws s3 ls "s3://${BUCKET}/${PREFIX}/" --endpoint-url "${R2_ENDPOINT_URL}" \
  | sort -k4 \
  | tail -1 \
  | awk '{ print $4 }')

if [ -z "${LATEST}" ]; then
  echo "❌ No dump at s3://${BUCKET}/${PREFIX}/" >&2
  exit 1
fi
echo "  found: ${LATEST}"

TMPDIR=$(mktemp -d)
trap "rm -rf ${TMPDIR}" EXIT

echo "▶ Downloading…"
aws s3 cp "s3://${BUCKET}/${PREFIX}/${LATEST}" "${TMPDIR}/${LATEST}" \
  --endpoint-url "${R2_ENDPOINT_URL}"

echo "▶ Decompressing…"
gunzip "${TMPDIR}/${LATEST}"
DUMP="${TMPDIR}/${LATEST%.gz}"

echo "▶ pg_restore into TARGET_DB_URL (clean restore)…"
pg_restore \
  --clean --if-exists \
  --no-owner --no-acl \
  --dbname="${TARGET_DB_URL}" \
  "${DUMP}"

echo ""
echo "▶ Integrity counts (target):"
psql "${TARGET_DB_URL}" --quiet --no-align --tuples-only --command "
  SELECT 'tenants'           AS table, count(*) FROM tenants
  UNION ALL SELECT 'tenant_providers',  count(*) FROM tenant_providers
  UNION ALL SELECT 'tenant_products',   count(*) FROM tenant_products
  UNION ALL SELECT 'tier_definitions',  count(*) FROM tier_definitions
  UNION ALL SELECT 'subscriptions',     count(*) FROM subscriptions;
"

echo ""
echo "✅ Restore complete. Compare counts above against production and"
echo "   append a drill row to docs/DR_RUNBOOK.md if this was a monthly drill."
