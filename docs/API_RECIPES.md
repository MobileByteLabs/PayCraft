---
id: API_RECIPES
title: Recipes
sidebar_label: Recipes
description: End-to-end workflows — release gates, sync pipelines, support lookups and incident triage.
---

# Recipes

Complete workflows, each one runnable as written. Set `PAYCRAFT_KEY` first.

## Gate a release on payment readiness

The question a release pipeline should ask before shipping a build that can take money.

```bash
#!/usr/bin/env bash
set -euo pipefail

API=https://api.paycraft.mobilebytesensei.com/v1
MODE="${1:-live}"   # live | test

readiness=$(curl -sf -H "Authorization: Bearer $PAYCRAFT_KEY" "$API/readiness")

not_ready=$(jq -r --arg m "$MODE" \
  '.providers[] | select(.[$m + "_ready"] == false) | .provider' <<<"$readiness")

if [ -n "$not_ready" ]; then
  echo "::error::Not ready for $MODE payments: $(tr '\n' ' ' <<<"$not_ready")"
  # Print what a human must do, rather than just failing.
  jq -r --arg m "$MODE" '
    .providers[]
    | select(.[$m + "_ready"] == false)
    | "\n\(.provider) — \(.[$m + "_detail"])"
      + (if .manual_steps then "\n  " + (.manual_steps | to_entries
          | map("\(.key+1). \(.value)") | join("\n  ")) else "" end)
  ' <<<"$readiness"
  exit 1
fi

echo "All providers ready for $MODE."
```

Scope needed: `readiness:read`.

Gate on `test` for internal builds and `live` for store releases. A store provider will report
`test_ready: false` until someone makes a sandbox purchase — that is expected, and the script prints
the steps rather than leaving the failure unexplained.

## Sync products safely in CI

```bash
#!/usr/bin/env bash
set -euo pipefail
API=https://api.paycraft.mobilebytesensei.com/v1
AUTH=(-H "Authorization: Bearer $PAYCRAFT_KEY")

report=$(curl -sf "${AUTH[@]}" "$API/sync")
count=$(jq .confirm_count <<<"$report")

if [ "$count" -eq 0 ]; then
  echo "Nothing to sync."; exit 0
fi

echo "$count finding(s):"
jq -r '.findings[] | "  · \(.kind) → \(.subject)"' <<<"$report"

result=$(curl -sf -X POST "${AUTH[@]}" -H 'content-type: application/json' \
  -d "{\"confirm_count\": $count}" "$API/sync")

jq -r '"synced: \(.synced)"' <<<"$result"

# A 200 does NOT mean every provider succeeded.
if [ "$(jq '.failed | length' <<<"$result")" -gt 0 ]; then
  jq -r '.failed[] | "  FAILED \(.subject) — \(.detail)"' <<<"$result"
  run_id=$(jq -r .run_id <<<"$result")
  echo "Per-provider detail:"
  curl -sf "${AUTH[@]}" "$API/sync/events?run_id=$run_id&status=failed" \
    | jq -r '.data[] | "  \(.provider): \(.message)"'
  exit 1
fi

jq -r '.skipped[]? | "  skipped \(.subject) — \(.detail)"' <<<"$result"
```

Scopes: `products:read` + `products:sync`.

Two details that matter. The `confirm_count` must come from the report you just read — a mismatch
returns 409 because the world changed between looking and acting. And `failed` and `skipped` are
inspected explicitly, because a 200 only means the drain ran.

## Answer a support question

"Is this customer actually subscribed?" — and the follow-up that catches the real cases.

```bash
EMAIL="a.customer@example.com"
API=https://api.paycraft.mobilebytesensei.com/v1
AUTH=(-H "Authorization: Bearer $PAYCRAFT_KEY")

# What the provider bills — filter to live, or a test row will answer a different question.
curl -sf "${AUTH[@]}" "$API/subscribers?email=$EMAIL&mode=live" \
  | jq -r '.data[] | "\(.provider) \(.plan): \(.status), renews \(.current_period_end)"'

# What PayCraft grants. These disagree during grace periods and refunds —
# and this is the one the app trusts.
curl -sf "${AUTH[@]}" "$API/entitlements?app_user_id=$EMAIL" \
  | jq -r '.data[] | "\(.provider) \(.canonical_state) expires \(.expires_at) grace \(.in_grace_until)"'
```

Scope: `subscribers:read`.

If the subscription says `active` and the entitlement says otherwise, the entitlement is right and
something upstream failed — check `/webhooks?status=failed` next.

## Triage after a provider incident

```bash
API=https://api.paycraft.mobilebytesensei.com/v1
AUTH=(-H "Authorization: Bearer $PAYCRAFT_KEY")

# Did we drop anything?
curl -sf "${AUTH[@]}" "$API/webhooks?status=failed&limit=50" \
  | jq -r '.data[] | "\(.created_at) \(.provider) \(.event_type): \(.error_message)"'

# What changed, and who changed it?
curl -sf "${AUTH[@]}" "$API/audit?limit=50" \
  | jq -r '.data[] | "\(.ts) \(.actor_type) \(.action) \(.resource)"'
```

Scopes: `webhooks:read` + `audit:read`.

Webhook payloads are stored redacted, so this is safe to paste into a ticket. The audit trail
includes this API's own actions as `actor_type: "api_key"`, so automated changes are as visible as
human ones.

## Snapshot the paywall to catch unintended changes

```bash
curl -sf -H "Authorization: Bearer $PAYCRAFT_KEY" \
  https://api.paycraft.mobilebytesensei.com/v1/paywall \
  | jq -S . > paywall.snapshot.json

git diff --exit-code paywall.snapshot.json || {
  echo "::error::Paywall changed — review before shipping"; exit 1; }
```

Scope: `paywall:read`. Commit the snapshot; a paywall that changes without anyone intending it then
fails a check instead of reaching customers.

## Rotate a key

Keys are stored as a hash and cannot be read back, so rotation is create-then-revoke:

1. **Settings → Developer API → New key** with the same scopes
2. Update the secret wherever the old one lives
3. Confirm the new key works — `GET /v1/tenant` returns its `key.scopes`
4. Revoke the old one

Check `last_used_at` on the old key before revoking. If it is still being used, something you forgot
is still pointing at it.
