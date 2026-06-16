#!/usr/bin/env bash
# Idempotent migration applier for PayCraft self-host.
# Reads ../../server/migrations/*.sql in lexical order and applies any not yet
# in the _paycraft_migrations ledger table.
#
# Usage: PAYCRAFT_DB_PASSWORD=… ./migrations-bootstrap.sh
set -euo pipefail

: "${PAYCRAFT_DB_PASSWORD:?Set PAYCRAFT_DB_PASSWORD (see .env.example)}"
DB_URL="${PAYCRAFT_DB_URL:-postgres://postgres:${PAYCRAFT_DB_PASSWORD}@localhost:54322/postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG_DIR="${HERE}/../../server/migrations"

if ! command -v psql >/dev/null 2>&1; then
  # Fall back to docker exec into the db container
  PSQL=(docker exec -i ${PAYCRAFT_DB_CONTAINER:-paycraft_db} psql -U postgres)
else
  PSQL=(psql "$DB_URL")
fi

"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS _paycraft_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null

applied=0
skipped=0
for f in $(ls -1 "$MIG_DIR" | grep -E '^[0-9]+_.*\.sql$' | sort); do
  version="${f%.sql}"
  exists=$("${PSQL[@]}" -tAc "SELECT 1 FROM _paycraft_migrations WHERE version='${version}'")
  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "  apply ${version}"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -1 < "${MIG_DIR}/${f}"
  "${PSQL[@]}" -c "INSERT INTO _paycraft_migrations(version) VALUES ('${version}')" >/dev/null
  applied=$((applied + 1))
done

echo "✅ migrations: ${applied} applied, ${skipped} skipped"
