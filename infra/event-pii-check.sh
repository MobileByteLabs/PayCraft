#!/usr/bin/env bash
# infra/event-pii-check.sh — no personal data in paywall events, at any layer (paycraft-paywall-analytics GOAL D10).
#
# A paywall event travels: the SDK's PayCraftEvent → its params() (what a site/app forwards to GA4 / Firebase) →
# PayCraftContract.eventsBody (the wire) → the `events` function's rows → the paywall_events table. Each layer's
# fields are read from the source and checked against an ALLOWLIST: a new field — `email`, `free_text`, anything —
# fails here until someone reviews it and adds it on purpose. Since paycraft-attempt-observability (migration 210) an
# event can also carry a purchase-attempt id and a failure, which land in paywall_events.attempt_id and the
# attempt_events timeline — those two schema layers are read from the 210 migration (--attempts) and held to the
# same rule. (A denylist of bad words would pass `mail`, `userName`,
# `contact`…; the buyer is identified server-side by a hash and survey free text is stored first-party only.)
#
# Usage: bash infra/event-pii-check.sh [--event F] [--contract F] [--ingest F] [--table F] [--attempts F]
#        (defaults: the repo)
# Exit 0 = PASS · 1 = a field off the allowlist (named, with its layer) · 2 = an input missing or nothing extracted.
set -euo pipefail
EVENT="cmp-paycraft-core/src/commonMain/kotlin/com/mobilebytelabs/paycraft/analytics/PayCraftEvent.kt"
CONTRACT="cmp-paycraft-core/src/commonMain/kotlin/com/mobilebytelabs/paycraft/contract/PayCraftContract.kt"
INGEST="supabase/functions/events/index.ts"
TABLE="supabase/migrations/180_paywall_events.sql"
ATTEMPTS="supabase/migrations/210_payment_attempts.sql"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --event) EVENT="$2"; shift 2 ;;
    --contract) CONTRACT="$2"; shift 2 ;;
    --ingest) INGEST="$2"; shift 2 ;;
    --table) TABLE="$2"; shift 2 ;;
    --attempts) ATTEMPTS="$2"; shift 2 ;;
    *) echo "usage: $0 [--event F] [--contract F] [--ingest F] [--table F] [--attempts F]" >&2; exit 2 ;;
  esac
done
for f in "$EVENT" "$CONTRACT" "$INGEST" "$TABLE" "$ATTEMPTS"; do [[ -s "$f" ]] || { echo "FAIL missing input: $f"; exit 2; }; done

# What each layer may carry. Identity is only ever a hash (user_ref) or the device's own random id (device_ref).
# attempt_id / attemptId (migration 210): the SDK's random purchase-attempt id (`<millis>-<hex>`) — names an attempt,
# never a person. failure (PayCraftFailure): a closed-set stage plus lowercase slugs error_class / code, and an
# error_message that PayCraftFailure scrubs (emails, phone / card numbers, keys, JWTs) and cuts to 200 characters on
# the device, which the server's sanitiseMessage repeats. The message travels to PayCraft's own ingest only — it is
# deliberately NOT in params(), so it never reaches an app's GA4.
ALLOW_EVENT="name step platform trigger sku currency country provider reason atMs experiment variant attemptId failure"
ALLOW_PARAMS="step platform trigger sku currency country provider reason experiment variant attempt_id stage error_class code"
ALLOW_WIRE="apiKey deviceRef deviceToken events name step platform trigger sku currency provider reason experiment variant attempt_id failure stage error_class error_code error_message at"
ALLOW_ROWS="name step platform trigger sku currency provider reason experiment variant attempt_id occurred_at tenant_id user_ref device_ref country mode"
ALLOW_TABLE="id tenant_id user_ref device_ref name step platform trigger sku currency provider reason country mode occurred_at received_at experiment variant attempt_id"
ALLOW_TIMELINE="id attempt_id tenant_id stage event error_class error_code error_message occurred_at"

event_fields="$(perl -0ne 'if (/public class PayCraftEvent\((.*?)\n\)/s) { my $b = $1; print "$1\n" while $b =~ /public val (\w+)\s*:/g }' "$EVENT")"
params_keys="$(perl -0ne 'if (/fun params\(\)(.*?)(?:private companion|\n\}\n)/s) { my $b = $1; print "$1\n" while $b =~ /put\("(\w+)"/g }' "$EVENT")"
wire_keys="$(perl -0ne 'if (/fun eventsBody\((.*?)(?:\n    fun |\z)/s) { my $b = $1; print "$1\n" while $b =~ /put\("(\w+)"/g }' "$CONTRACT")"
# Rows: the object pushed per event plus the fields added at insert. Calls are stripped, then `key:` and shorthand.
rows_keys="$(perl -0ne '
  my @blocks;
  push @blocks, $1 if /rows\.push\(\{(.*?)\n\s*\}\)/s;
  push @blocks, $1 if /rows\.map\(\(r\) => \(\{\s*\.\.\.r,(.*?)\}\)\)/s;
  for my $b (@blocks) {
    1 while $b =~ s/\([^()]*\)//g;
    for my $part (split /[,\n]/, $b) {
      $part =~ s/^\s+|\s+$//g;
      next if $part eq "";
      if ($part =~ /^([A-Za-z_]\w*)\s*:/) { print "$1\n" } elsif ($part =~ /^([A-Za-z_]\w*)$/) { print "$1\n" }
    }
  }' "$INGEST")"
table_cols="$(perl -0ne 'if (/CREATE TABLE IF NOT EXISTS public\.paywall_events \((.*?)\n\);/s) { for (split /\n/, $1) { print "$1\n" if /^\s+([a-z_]+)\s+[A-Z]/ && $1 !~ /^(constraint|primary|unique|check|foreign)$/i } }' "$TABLE")"
# Later migrations widen paywall_events with ADD COLUMN; those columns are table columns too.
added_cols="$(perl -ne 'print "$1\n" if /ALTER TABLE (?:public\.)?paywall_events ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/i' "$ATTEMPTS")"
table_cols="$(printf '%s\n%s\n' "$table_cols" "$added_cols" | sed '/^$/d')"
timeline_cols="$(perl -0ne 'if (/CREATE TABLE IF NOT EXISTS public\.attempt_events \((.*?)\n\);/s) { for (split /\n/, $1) { print "$1\n" if /^\s+([a-z_]+)\s+[A-Z]/ && $1 !~ /^(constraint|primary|unique|check|foreign)$/i } }' "$ATTEMPTS")"

fail=0
check() {
  local layer="$1" allow="$2" found="$3"
  [[ -n "$found" ]] || { echo "FAIL nothing extracted for $layer — the source changed shape; update this gate"; exit 2; }
  local k
  for k in $(sort -u <<<"$found"); do
    [[ " $allow " == *" $k "* ]] || { echo "FAIL $layer carries '$k' — not on the allowlist (personal data? review, then add it here)"; fail=1; }
  done
}
check "PayCraftEvent fields" "$ALLOW_EVENT" "$event_fields"
check "PayCraftEvent.params() (forwarded to GA4)" "$ALLOW_PARAMS" "$params_keys"
check "eventsBody (wire)" "$ALLOW_WIRE" "$wire_keys"
check "events function rows" "$ALLOW_ROWS" "$rows_keys"
check "paywall_events columns" "$ALLOW_TABLE" "$table_cols"
check "attempt_events columns (timeline)" "$ALLOW_TIMELINE" "$timeline_cols"
[[ $fail -eq 0 ]] && echo "PASS event pii (6 layers on the allowlist)"
exit $fail
