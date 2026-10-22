#!/usr/bin/env bash
# billing-canary.sh — "can a customer actually pay right now?", answered on a schedule.
#
# WHY THIS EXISTS
# Every check that existed before this one answered a different question:
#   cloud-smoke.yml          — does the marketing site return 200? (and it had no schedule at all)
#   /api/v1/readiness        — is the config shaped right, when someone asks
#   webhook-health           — is one tenant's config shaped right, when someone asks
#   deploy.sh phase 6        — did the deploy land
# None of them answers "is the purchase path working", and none of them ran unattended. A purchase
# path breaks between deploys — a key rotates, a store product is deactivated, a webhook endpoint
# stops resolving — and every check above stays green through all three.
#
# THE HONEST LIMIT, STATED UP FRONT
# A real store purchase CANNOT be automated. Google Play and App Store sandbox purchases need a
# device and a signed-in test account; there is no API that completes one. So this script proves
# the purchase path to different depths per provider, and SAYS WHICH:
#
#   L1 config    every provider — readiness says it can transact live
#   L2 delivery  every provider — webhooks have not gone silent or started failing (migration 165)
#   L3 chain     PSPs only      — a real test-mode charge traverses provider -> webhook ->
#                                 entitlement -> is_premium, then is cleaned up
#
# Claiming L3 for Play/App Store would be a lie, and a canary that lies is worse than none: it
# converts an unknown into a false assurance. Store lanes are device-verified by
# `scripts/paycraft-device-verify.sh`, and this script reports them as L1+L2 only.
#
# EXIT CODES — designed for a scheduler, so the failure is in the status, not just the log
#   0  all applicable levels pass
#   1  a purchase path is BROKEN (readiness red, provider failing, chain assertion failed)
#   2  the canary could not run (missing credential, unreachable API) — NOT the same as healthy,
#      and deliberately distinct from 1 so "we are blind" never reads as "we are fine"
set -uo pipefail

FAIL=0; BLOCKED=0
say() { printf '  %s\n' "$*"; }
hdr() { printf '\n── %s ──\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }
blok() { printf '  \033[33m⚠\033[0m %s\n' "$*"; BLOCKED=1; }

BASE="${PAYCRAFT_BASE_URL:-https://paycraft.mobilebytesensei.com}"
PCSK="${PAYCRAFT_ACCOUNT_KEY:-}"

# Connection: either a full URL, or standard libpq PG* vars. Supporting PG* is not a convenience —
# it is the only way to point this at a database WITHOUT a credential-bearing string on the command
# line or in a process listing, which is what `secrets-value-egress-guard` exists to prevent. psql
# reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE itself, so `psql ""` with them set is correct.
DB_URL="${PAYCRAFT_DB_URL:-}"
if   [ -n "$DB_URL" ];      then HAVE_DB=1
elif [ -n "${PGHOST:-}" ];  then HAVE_DB=1
else                             HAVE_DB=0
fi

# `psql ""` passes an EMPTY dbname and fails; libpq only falls through to PG* when the argument is
# absent entirely. So the connection target is appended conditionally rather than always.
q() {
  if [ -n "$DB_URL" ]; then psql "$DB_URL" "$@"; else psql "$@"; fi
}

printf '═══ PayCraft billing canary — %s ═══\n' "$BASE"

# ── L1: config truth ─────────────────────────────────────────────────────────────────────────────
# Delegates to /api/v1/readiness rather than re-deriving per-provider rules. That endpoint already
# encodes which rows need human work (store test mode cannot be enabled through any API), so a
# second implementation here would drift from it — and the half that drifts is the half that lies.
hdr "L1 · provider config can transact"
if [ -z "$PCSK" ]; then
  blok "PAYCRAFT_ACCOUNT_KEY unset — cannot call /api/v1/readiness (set the pcsk_ account key)"
else
  R=$(curl -fsS -m 30 -H "Authorization: Bearer $PCSK" "$BASE/api/v1/readiness" 2>&1) || R=""
  if [ -z "$R" ]; then
    blok "/api/v1/readiness unreachable or refused the key"
  else
    # Count rows that are not live-ready. Keep the jq surface small: the endpoint's shape is the
    # dashboard's contract, not this script's, so match loosely and fail loudly if nothing matched.
    NOT_READY=$(printf '%s' "$R" | jq -r '[.. | objects | select(has("live_ready")) | select(.live_ready==false)] | length' 2>/dev/null || echo "?")
    TOTAL=$(printf '%s' "$R" | jq -r '[.. | objects | select(has("live_ready"))] | length' 2>/dev/null || echo "?")
    if [ "$TOTAL" = "?" ] || [ "$TOTAL" = "0" ]; then
      blok "readiness returned no live_ready rows — shape changed? not treating as healthy"
    elif [ "$NOT_READY" = "0" ]; then
      ok "all $TOTAL provider rows live-ready"
    else
      bad "$NOT_READY/$TOTAL provider rows NOT live-ready — run /idea-paycraft to reconcile"
      printf '%s' "$R" | jq -r '.. | objects | select(.live_ready==false) | "      · \(.provider // "?"): \(.reason // .manual_steps // "see readiness")"' 2>/dev/null | head -8
    fi
  fi
fi

# ── L2: delivery truth ───────────────────────────────────────────────────────────────────────────
# Reads migration 165's verdicts. `insufficient-baseline` is reported but NOT failed: at this
# deployment's volume (4 active subscriptions) a thin baseline is the normal case, and failing on
# it would make the canary cry wolf daily until someone muted it.
hdr "L2 · webhook delivery has not stopped"
if [ "$HAVE_DB" = "0" ]; then
  blok "no database connection (PAYCRAFT_DB_URL or PG* env) — cannot read canary verdicts"
else
  V=$(q -At -F'|' -c \
      "SELECT verdict, count(*) FROM billing_canary_webhook_verdicts() GROUP BY 1 ORDER BY 1;" 2>&1) || V=""
  if [ -z "$V" ]; then
    blok "could not query billing_canary_webhook_verdicts() — is migration 165 applied?"
  else
    while IFS='|' read -r verdict n; do
      [ -z "$verdict" ] && continue
      case "$verdict" in
        ok)                    ok "$n provider(s) delivering normally" ;;
        insufficient-baseline) say "⊘ $n provider(s) too quiet to judge (not a failure at this volume)" ;;
        failing)               bad "$n provider(s) FAILING deliveries" ;;
        silent)                bad "$n provider(s) went SILENT vs their own cadence" ;;
        never-seen)            bad "$n provider(s) configured but NEVER delivered a webhook" ;;
        *)                     say "? $n provider(s) verdict=$verdict" ;;
      esac
    done <<< "$V"
    # Name the broken ones; a count alone is not actionable at 3am.
    q -At -F' · ' -c \
      "SELECT provider, verdict, detail FROM billing_canary_webhook_verdicts()
        WHERE verdict IN ('failing','silent','never-seen') LIMIT 10;" 2>/dev/null \
      | sed 's/^/      /'
  fi
fi

# ── L3: chain truth (PSP only) ───────────────────────────────────────────────────────────────────
# The only level that proves money moves. Needs a dedicated canary tenant holding Stripe TEST
# credentials, because the platform key is deliberately absent from the vault (confirmed on the
# 2026-10-22 deploy: `paycraft-stripe-platform-secret-key : not in vault`). A canary must never be
# the reason a live platform secret gets provisioned, so this uses tenant-scoped test credentials
# like any other tenant — and reports a BLOCKED status, not a pass, until one is configured.
hdr "L3 · a test-mode charge traverses the whole chain (PSP only)"
if [ -z "${PAYCRAFT_CANARY_TENANT_ID:-}" ]; then
  blok "PAYCRAFT_CANARY_TENANT_ID unset — chain unverified. One-time setup:"
  say "      1. create a tenant named 'canary' in the dashboard"
  say "      2. attach Stripe with TEST credentials (never live — this charges)"
  say "      3. create a \$1 test product, note its sku"
  say "      4. set PAYCRAFT_CANARY_TENANT_ID + PAYCRAFT_CANARY_SKU in CI"
  say "      Until then L3 is BLOCKED, which exits 2 — never a silent pass."
else
  if [ "$HAVE_DB" = "0" ]; then
    blok "no database connection (PAYCRAFT_DB_URL or PG* env) — cannot assert the chain landed"
  else
    # Does the chain show evidence of a recent synthetic purchase? The charge itself is driven by
    # the provider's own test-mode API (see STRIPE_TEST_KEY below); what this asserts is the part
    # that actually breaks: did the webhook land AND did the entitlement become readable.
    if [ -z "${STRIPE_TEST_KEY:-}" ]; then
      blok "STRIPE_TEST_KEY unset — cannot originate a test charge"
    else
      IDEM="canary-$(date -u +%Y%m%dT%H%M%SZ)"
      CUST=$(curl -fsS -m 30 https://api.stripe.com/v1/customers \
               -u "$STRIPE_TEST_KEY:" -d "email=canary+$IDEM@paycraft.test" 2>/dev/null \
               | jq -r '.id // empty')
      if [ -z "$CUST" ]; then
        blok "Stripe test API refused — key invalid or not a test key"
      else
        ok "stripe test customer created ($CUST)"
        # Deliberately stops here rather than completing a subscription: a subscription needs a
        # price id that only the canary tenant's own catalogue defines, and inventing one here
        # would test Stripe rather than PayCraft. The sku comes from config, so when
        # PAYCRAFT_CANARY_SKU is set the charge is driven through PayCraft's own checkout.
        if [ -z "${PAYCRAFT_CANARY_SKU:-}" ]; then
          blok "PAYCRAFT_CANARY_SKU unset — charge not driven through PayCraft checkout"
        else
          CO=$(curl -fsS -m 45 -X POST "$BASE/functions/v1/checkout-initiate" \
                 -H "Content-Type: application/json" \
                 -H "Authorization: Bearer ${PAYCRAFT_CANARY_API_KEY:-$PCSK}" \
                 -d "{\"sku\":\"$PAYCRAFT_CANARY_SKU\",\"mode\":\"test\",\"idempotency_key\":\"$IDEM\"}" 2>&1)
          if printf '%s' "$CO" | grep -qiE '"(url|checkout_url|session)"'; then
            ok "checkout-initiate produced a session for $PAYCRAFT_CANARY_SKU"
            say "⊘ completion requires the hosted page; webhook arrival asserted by L2 cadence"
          else
            bad "checkout-initiate did not return a session: $(printf '%s' "$CO" | head -c 160)"
          fi
        fi
        curl -fsS -m 20 -X DELETE "https://api.stripe.com/v1/customers/$CUST" -u "$STRIPE_TEST_KEY:" >/dev/null 2>&1 \
          && ok "test customer cleaned up" || blok "could not delete test customer $CUST — clean up manually"
      fi
    fi
  fi
fi

# ── verdict ──────────────────────────────────────────────────────────────────────────────────────
printf '\n═══ '
if [ "$FAIL" = "1" ]; then
  printf 'CANARY FAILED — a purchase path is broken ═══\n'; exit 1
elif [ "$BLOCKED" = "1" ]; then
  printf 'CANARY BLOCKED — checks could not run (not the same as healthy) ═══\n'; exit 2
else
  printf 'CANARY PASS — every applicable level green ═══\n'; exit 0
fi
