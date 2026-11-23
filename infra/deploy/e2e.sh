#!/usr/bin/env bash
# PayCraft post-deploy end-to-end check — the SDK's real paths against a DEPLOYED backend.
#
#   bash infra/deploy/e2e.sh                       # production (default)
#   bash infra/deploy/e2e.sh --ref <project-ref> --db-alias <vault-alias>
#
# Phase 6 of deploy.sh runs it after the smoke curls. What it proves that smoke cannot:
#   A. schema   migration 206's own SQL test (BEGIN…ROLLBACK, leaves nothing) + 207/208 objects exist
#   B-D. A/B    a running experiment reaches /config, /events stores variant tags (an invalid tag is
#               dropped, the event kept), paywall_experiment_results counts each arm
#   E. 208      /attribution-ids is deployed and rejects an unknown device
#   F. 207      /apple-server-notifications is deployed and rejects a forged payload
#
# Writes go to ONE throwaway tenant (pk_live_e2e…), deleted on exit — including a failed or aborted
# run. The DB url is read from the vault into a 0600 temp file and never printed.
set -uo pipefail

REF="mlwfgytjxlqyfxcgpysm"
DB_ALIAS="framework-supabase-db-url"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --ref) REF="$2"; shift 2 ;;
        --db-alias) DB_ALIAS="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
PC="$(cd "$HERE/../.." && pwd)"
FW="$(cd "$PC/../../../../.." && pwd)"
FN="https://${REF}.supabase.co/functions/v1"

F=$(mktemp); chmod 600 "$F"
T=""
cleanup() {
    if [[ -n "$T" ]]; then
        q "delete from paywall_events where tenant_id='$T'; delete from tenants where id='$T'" >/dev/null 2>&1 \
            && echo "  ✓ throwaway tenant deleted" || echo "  ✗ throwaway tenant $T NOT deleted — remove it by hand"
    fi
    rm -P -f "$F" 2>/dev/null || rm -f "$F"
}
trap cleanup EXIT
bash "$FW/core/scripts/secrets-get.sh" "$DB_ALIAS" --to-file "$F" >/dev/null 2>&1 || { echo "  ✗ $DB_ALIAS not resolvable from vault"; exit 1; }
DB=$(cat "$F")
q() { psql "$DB" -v ON_ERROR_STOP=1 -Atqc "$1"; }
FAILS=0; ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAILS=$((FAILS+1)); }

echo "▶ A. schema"
psql "$DB" -v ON_ERROR_STOP=1 -q < "$PC/supabase/tests/206_paywall_experiments_test.sql" 2>&1 | grep -q "PASS 206" \
    && ok "206 SQL test" || bad "206 SQL test"
[ "$(q "select count(*) from information_schema.columns where table_name='tenants' and column_name in ('appstore_consumption_consent','appstore_refund_preference')")" = 2 ] \
    && ok "207 tenant columns" || bad "207 tenant columns"
[ "$(q "select count(*) from pg_tables where schemaname='public' and tablename in ('appstore_consumption_responses','tenant_attribution_integrations','device_attribution_ids','attribution_forwards')")" = 4 ] \
    && ok "207/208 tables" || bad "207/208 tables"

echo "▶ B. throwaway tenant + running experiment"
KEY="pk_live_e2e$(uuidgen | tr -d - | tr 'A-Z' 'a-z')"
T=$(q "insert into tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live) values ('e2e-deploy-check','e2e@test.local','pk_test_e2e'||gen_random_uuid(),'$KEY','w','w') returning id" | head -1)
[[ -n "$T" ]] || { bad "create tenant"; exit 1; }
O1=$(q "insert into tenant_offerings (tenant_id, identifier, display_name, is_current) values ('$T','control','Control',true) returning id" | head -1)
O2=$(q "insert into tenant_offerings (tenant_id, identifier, display_name) values ('$T','cheaper','Cheaper') returning id" | head -1)
q "select paywall_experiment_save('$T','price-test','Price test',jsonb_build_array(jsonb_build_object('key','control','weight',50,'offering_id','$O1'),jsonb_build_object('key','cheaper','weight',50,'offering_id','$O2')))" >/dev/null \
  && q "select paywall_experiment_set_status('$T','price-test','running')" >/dev/null && ok "experiment running" || bad "start experiment"

echo "▶ C. /config"
curl -s "$FN/config?apiKey=$KEY" | jq -e '.experiment.key=="price-test" and (.experiment.variants|length)==2' >/dev/null \
    && ok "serves the running experiment" || bad "/config has no experiment"

echo "▶ D. /events"
NOW=$(($(date +%s)*1000))
ev() { printf '{"name":"%s","step":"paywall","platform":"android","at":%s,"experiment":"price-test","variant":"%s"}' "$1" "$NOW" "$2"; }
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$FN/events" -H 'content-type: application/json' -d "$1"; }
for v in control cheaper; do
    [ "$(post "{\"apiKey\":\"$KEY\",\"deviceRef\":\"e2e-$v\",\"events\":[$(ev paycraft_paywall_view $v),$(ev paycraft_checkout_start $v)]}")" = 202 ] || bad "events $v"
done
[ "$(post "{\"apiKey\":\"$KEY\",\"deviceRef\":\"e2e-bad\",\"events\":[$(ev paycraft_paywall_view 'BAD VARIANT')]}")" = 202 ] || bad "events bad-variant"
[ "$(q "select count(*) from paywall_events where tenant_id='$T' and variant in ('control','cheaper')")" = 4 ] \
    && ok "4 events tagged" || bad "tagged event count"
[ "$(q "select count(*) from paywall_events where tenant_id='$T' and variant is null")" = 1 ] \
    && ok "invalid variant dropped, event kept" || bad "invalid variant handling"
[ "$(q "select count(*) from paywall_experiment_results('$T','price-test') where viewers=1 and checkouts=1")" = 2 ] \
    && ok "results: 1 viewer + 1 checkout per arm" || bad "experiment results"

echo "▶ E. /attribution-ids"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN/attribution-ids" -H 'content-type: application/json' -d "{\"apiKey\":\"$KEY\",\"deviceToken\":\"srv_nope\",\"appsFlyerId\":\"1234567890123-1234567\"}")" = 401 ] \
    && ok "rejects unknown device (401)" || bad "/attribution-ids"

echo "▶ F. /apple-server-notifications"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN/apple-server-notifications" -H 'content-type: application/json' -d '{"signedPayload":"x.y.z"}')" = 400 ] \
    && ok "rejects forged payload (400)" || bad "/apple-server-notifications"

echo "▶ cleanup"
cleanup; T=""
echo "E2E FAILS=$FAILS"
[[ $FAILS -eq 0 ]]
