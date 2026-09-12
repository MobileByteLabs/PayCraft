#!/usr/bin/env bash
# Shared DB harness for the commercial-model canaries (sub-plan 02).
#
# WHY docker exec RATHER THAN psql
# psql is not installed on this machine, but the local Supabase stack ships postgres in a
# container — so the client is reachable through `docker exec` without adding a host dependency
# that every future runner would also need.
#
# WHY A LOCAL DATABASE AND NEVER PRODUCTION
# Migration 088 carries a backfill DO block that WRITES to tenant_products, and several of these
# canaries insert tenants and entitlement rows. Pointing them at production would mutate live
# merchant data to test a migration. The harness therefore refuses any URL that is not local.
set -uo pipefail

PC_DB_CONTAINER="${PC_DB_CONTAINER:-supabase_db_PayCraft}"
export PC_DB_CONTAINER

# psql_run <<'SQL' — runs SQL in the local container, ON_ERROR_STOP so a failure is a failure.
psql_run() {
    docker exec -i "$PC_DB_CONTAINER" \
        psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

# psql_val <sql> — single scalar, whitespace-trimmed.
psql_val() {
    docker exec -i "$PC_DB_CONTAINER" \
        psql -tA -U postgres -d postgres -c "$1"
}

require_db() {
    if ! docker exec "$PC_DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
        echo "SKIP — local Supabase DB not reachable (container '$PC_DB_CONTAINER')." >&2
        echo "       Start it with: supabase start" >&2
        return 2
    fi
}

# Every canary works inside a savepoint-style scratch tenant it creates and drops, so runs are
# repeatable and leave the local DB as they found it.
# tenants has no `slug`; name / api_key_test / api_key_live / owner_email are all NOT NULL with
# no default. The api-key values here are deliberately NOT key-shaped (no pk_/sk_ prefix, short)
# so a fixture never looks like a credential to the repo's staged-secret guard.
new_tenant() { # new_tenant <uuid> <label>
    psql_run >/dev/null <<SQL
INSERT INTO tenants (id, name, api_key_test, api_key_live, owner_email)
VALUES ('$1', '$2', 'canary-$2-t', 'canary-$2-l', 'canary@local.test')
ON CONFLICT (id) DO NOTHING;
SQL
}
drop_tenant() { # drop_tenant <uuid>
    psql_run >/dev/null 2>&1 <<SQL
DELETE FROM entitlement_records WHERE tenant_id = '$1';
DELETE FROM tenant_products    WHERE tenant_id = '$1';
DELETE FROM tenant_packages    WHERE tenant_id = '$1';
DELETE FROM tenant_offerings   WHERE tenant_id = '$1';
DELETE FROM tenants            WHERE id        = '$1';
SQL
}
