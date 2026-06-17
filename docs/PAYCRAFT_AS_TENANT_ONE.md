# PayCraft as Tenant #1 — Dogfooding Runbook

> Phase 1 of paycraft-v2-production-readiness — provisions the PayCraft
> platform itself as a tenant in its own multi-tenant database, so PayCraft
> charges its customers (developers) via the same Stripe Connect onboarding
> flow as every other tenant. RESEARCH.md D4.

**Effective:** 2026-06-17
**Prerequisite:** `docs/STRIPE_ACTIVATION.md` is DONE (live Stripe account active).
**One-time:** Run this exactly once. Subsequent edits to PayCraft's own tier
prices are done via the normal `/products` and `/tiers` UI like any tenant.

---

## Why this matters

If PayCraft were billed differently from every other tenant, we would have
two billing code paths: one for "PayCraft customers" and one for "everyone
else". That fork would silently rot.

So PayCraft *is* a tenant. The platform Stripe account also accepts payments
from PayCraft tenants for their PayCraft subscriptions (Pro / Enterprise),
routed through Stripe Connect with `application_fee_amount = 0` because
the tenant *is* the platform.

This is the test that proves the multi-tenant architecture is real:
**we can charge ourselves with the same code that charges anyone.**

---

## Procedure (one-time, ≤ 30 min)

### Step 1 — Sign up for PayCraft as a regular user

```text
Open https://paycraft.mobilebytesensei.com
  → Click "Sign in with Google"
  → Sign in as founder@mobilebytesensei.com (NOT a personal Gmail)
  → /onboarding wizard:
       slug:    paycraft
       tier:    Free  (will upgrade to Pro via Stripe checkout below)
       country: <your country>
```

### Step 2 — Connect Stripe Connect — **at the platform Stripe account**

This is the unusual bit. Most tenants connect a *different* Stripe account.
PayCraft as tenant #1 connects the **platform** Stripe account itself.

```text
Settings → Providers → Stripe → "Connect with Stripe"
  → Stripe OAuth screen
  → Sign in to dashboard.stripe.com using the platform account
  → Approve "Allow PayCraft to read/write payments on your behalf"
  → Redirect back to /settings/providers
```

Verify in Postgres:

```sql
SELECT id, slug, stripe_account_id
FROM tenants
JOIN tenant_stripe_connect USING (tenant_id)
WHERE slug = 'paycraft';
-- Expected: stripe_account_id = the platform's account ID (acct_…)
```

This is intentionally an `application_fee_amount = 0` Connect relationship.
Tenant `paycraft` pays Stripe directly; no platform fee is taken.

### Step 3 — Seed PayCraft's own tier definitions

Migration `032_tier_definitions_seed.sql` already inserted three rows into
`tier_definitions`:

| Tier | Monthly | Annual | Stripe price ID |
|---|---|---|---|
| Free | $0 | $0 | _(not in Stripe)_ |
| Pro | $19 | $190 | _populated here_ |
| Enterprise | $99 | $990 | _populated here_ |

To populate the Stripe prices for PayCraft itself:

1. Dashboard → Products → "New Product"
2. Name: `PayCraft Pro`. Description: `Unlimited webhooks, 100K MAU, priority support.`
3. Add price: $19 USD / month. Add price: $190 USD / year.
4. Save. The dashboard records `prod_*` and `price_*` in `tenant_products` for
   the `paycraft` tenant.

```sql
UPDATE tier_definitions
SET stripe_product_id = $1,
    stripe_price_id_monthly = $2,
    stripe_price_id_annual = $3
WHERE name = 'pro';

UPDATE tier_definitions
SET stripe_product_id = $4,
    stripe_price_id_monthly = $5,
    stripe_price_id_annual = $6
WHERE name = 'enterprise';
```

(In practice, the dashboard's tier-edit page will do this for you once
phase 1 ships. For now, this is a one-time SQL update via Supabase Studio.)

### Step 4 — Test the platform charges itself

This is the proof that the platform billing loop closes.

1. From an *incognito* browser window, sign up as a new tenant
   `dogfood-test-2026-06-17@example.com` with slug `dogfood-test`.
2. Pick the Pro tier. Land at Stripe Checkout (live mode). Use a real
   card; charge ~$19.
3. Webhook arrives → `subscriptions.status = active` on the `dogfood-test`
   tenant row.
4. Refund the $19.00 from Stripe dashboard.
5. Webhook arrives → `subscriptions.status = canceled`.
6. Delete the `dogfood-test` tenant row.

### Step 5 — Wire the PayCraft marketing site checkout buttons

`dashboard/app/(marketing)/pricing/page.tsx` — verify the "Upgrade to Pro"
button posts to `/api/checkout/start?tier=pro` which:

1. Resolves the current user → finds their `tenants` row.
2. Hits Stripe `checkout.sessions.create` with `price_id` from
   `tier_definitions.stripe_price_id_monthly`.
3. Redirects to Stripe-hosted checkout.

End-user paying for PayCraft = same code path as end-user paying for
reels-downloader. **Same `BillingManager.isPremium()` semantics, same
webhook handler, same `subscriptions` row shape.**

---

## Verification checklist (Phase 1 acceptance gate)

- [ ] Tenant row exists with `slug = 'paycraft'`.
- [ ] `tenant_stripe_connect` row links tenant `paycraft` to the platform
  Stripe account.
- [ ] `tier_definitions` has Pro + Enterprise prices populated.
- [ ] Pricing page "Upgrade" button reaches Stripe Checkout in live mode.
- [ ] One real test transaction succeeds + refunds cleanly.
- [ ] `subscriptions` row for `dogfood-test` cycles `active → canceled` via
  webhooks (no manual SQL writes).

---

## Anti-patterns

1. **Hard-coding PayCraft's prices in `dashboard/app/(marketing)/pricing/page.tsx`.**
   The page reads from `tier_definitions` — never hard-code USD amounts in
   marketing components.

2. **Different webhook handler for PayCraft's own subscriptions.**
   There is one webhook handler. PayCraft's tenant ID is just another
   `tenant_id` flowing through `subscriptions_upsert`.

3. **`pk_test_*` keys in the PayCraft tenant's `tenant_providers` row.**
   This is the platform account in production. It MUST be `pk_live_*` and
   `sk_live_*`. Validated by the `live_mode_check` constraint added in
   migration 049.

---

## Related

- `docs/STRIPE_ACTIVATION.md` — prerequisite runbook.
- `docs/REELS_DOWNLOADER_INTEGRATION.md` — sister doc: an *external* tenant
  going through the same flow.
- `RESEARCH.md` D4 — rationale: PayCraft uses PayCraft.
- `GOAL.md` AC11-AC20 — Phase 1 acceptance criteria.
- `dashboard/app/(marketing)/pricing/page.tsx` — checkout entry point.
- `supabase/migrations/032_tier_definitions_seed.sql` — tier seed data.
