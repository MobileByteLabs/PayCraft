# PayCraft Stripe Activation Runbook

> Phase 1 of paycraft-v2-production-readiness — operational runbook for the
> one-time Stripe account activation that unlocks **live-mode** billing for
> the PayCraft platform itself (RESEARCH.md D4 — dogfood Stripe Connect).
>
> Until this is complete, PayCraft can only charge in test mode. Tenants can
> still onboard their *own* Stripe Connect accounts; this runbook is about
> PayCraft's *platform* Stripe account.

**Window:** 3-7 business days (Stripe identity + business verification)
**Blocker classification:** Phase 1 acceptance gate; no Phase 2 work merges
to `main` until this is GREEN.

---

## Pre-flight (≤ 15 min)

- [ ] Confirm legal entity name (MobileByteSensei Pvt Ltd) matches Stripe
  account-name in `https://dashboard.stripe.com/settings/account`.
- [ ] Confirm business address, founder ID (passport / Aadhaar+PAN for IN
  entity), and a bank account in the same country.
- [ ] Confirm reels-downloader (the canonical tenant in
  `docs/REELS_DOWNLOADER_INTEGRATION.md`) is already on its own separate
  Stripe Connect account — i.e. NOT sharing the PayCraft platform account.
  Verify in `tenant_providers` table where `tenant.slug = 'reels-downloader'`.

---

## Activation flow

### Step 1 — Submit identity + business verification

1. Sign in to `https://dashboard.stripe.com`.
2. Top-right → "Activate account".
3. Fill out:
   - Business type: Single-member private limited (or sole proprietor for
     early-stage)
   - Business website: `https://paycraft.mobilebytesensei.com`
   - Product / service description: "B2B SaaS platform that lets developers
     ship subscription billing into their KMP apps. Charges are for monthly
     /annual subscriptions paid by the developer (the customer); the
     developer's own end-users are charged via their separate Stripe Connect
     accounts."
   - Founder DOB + government ID
   - Bank account (USD or INR)
4. Submit.

### Step 2 — Wait (3-7 business days)

Stripe sends an email when verification is complete. You can check status at
`https://dashboard.stripe.com/settings/account`.

### Step 3 — Enable Connect

Once activation is approved:

1. `https://dashboard.stripe.com/settings/connect` → Enable Connect.
2. Choose **OAuth** (not Standard onboarding) so that PayCraft tenants
   complete onboarding entirely inside the PayCraft dashboard.
3. Set the OAuth redirect URI:
   `https://paycraft.mobilebytesensei.com/api/oauth/stripe/callback`
4. Note the `Client ID` (CA_*) — this goes into the vault as
   `mbs-paycraft-stripe-connect-client-id`.

### Step 4 — Pull live secrets into the vault

```bash
cd workspaces/mbs/PayCraft/source/PayCraft

# 1. Stripe restricted key (live mode)
# Get it from: dashboard.stripe.com → Developers → API keys → "Create restricted key"
# Permissions: charges:write, customers:write, payment_intents:write,
#              subscriptions:write, products:write, prices:write, payouts:read
bash core/scripts/secrets-keychain-load.sh --init \
  paycraft-stripe paycraft-live:STRIPE_LIVE_KEY
# (paste the rk_live_* value at the secure prompt)

security find-generic-password -s paycraft-stripe -a paycraft-live -w \
  | bash core/scripts/secrets-push.sh \
        --vault mbs-vault \
        --id mbs-paycraft-stripe-live-key \
        --stdin

# 2. Connect Client ID
echo "$STRIPE_CONNECT_CLIENT_ID" \
  | bash core/scripts/secrets-push.sh \
        --vault mbs-vault \
        --id mbs-paycraft-stripe-connect-client-id \
        --stdin
```

> **Never** type the `rk_live_*` value into chat or commit it. Use the
> macOS Keychain pattern above. See CLAUDE.md > RULE-SECRETS-MACOS-001.

### Step 5 — Sync to Vercel + redeploy

```bash
bash infra/sync-to-vercel.sh --apply --env production
/paycraft-deploy ship
```

### Step 6 — Verify

- [ ] Sign in to `https://paycraft.mobilebytesensei.com` as the founder
  account.
- [ ] Settings → Providers → Stripe → status shows "Active (live mode)".
- [ ] `tenant_providers` row for the founder's tenant has
  `stripe_account_id = acct_…` (a Stripe Connect account ID, not the
  platform account).
- [ ] Make a real test charge for $1.00 against reels-downloader's tenant
  (NOT PayCraft's own tenant) — verify webhook arrives, subscription
  activates.
- [ ] Refund the $1.00 immediately.

---

## What goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| "Restricted key has no rights for X" | Missing scope on rk_live_* | Recreate restricted key with full subscription scopes |
| OAuth callback fails with `redirect_uri_mismatch` | `https://paycraft.mobilebytesensei.com/api/oauth/stripe/callback` not added to Connect settings | Settings → Connect → add the exact URL |
| `/api/oauth/stripe/start` 500 | Vault not synced to Vercel | `bash infra/sync-to-vercel.sh --apply --env production` |
| Webhook 5xx after activation | `whsec_*` value still test-mode | Get live webhook secret from Stripe → push to vault → resync |
| Cannot retrieve customer that exists in another country's Stripe ledger | Stripe Connect doesn't share customers across accounts | This is by design — each tenant has their own customer ledger |

---

## Acceptance gate

This runbook is **DONE** when:

- [ ] Stripe account shows "Activated" + Connect enabled
- [ ] Live restricted key in vault
- [ ] Live webhook secret in vault
- [ ] Connect Client ID in vault
- [ ] Vercel env synced + production redeployed
- [ ] One real test charge against reels-downloader succeeds end-to-end

Open `plan-layer/.../paycraft-v2-production-readiness/01-self-monetize/PLAN.md`,
mark the relevant tasks as `[x]`, and commit.

---

## Related

- `docs/PAYCRAFT_AS_TENANT_ONE.md` — sister runbook: provision PayCraft's
  *own* tenant row (the platform dogfooding its own SaaS).
- `RESEARCH.md` D4 — rationale for dogfooding instead of building
  separate platform-charge code.
- `GOAL.md` AC1-AC10 — Phase 1 acceptance criteria.
- `dashboard/app/api/oauth/stripe/start/route.ts` — OAuth entry point.
- `dashboard/app/api/oauth/stripe/callback/route.ts` — OAuth callback.
