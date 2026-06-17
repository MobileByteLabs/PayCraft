# reels-downloader × PayCraft — Real-World Integration Case Study

> Phase 5 of paycraft-v2-production-readiness — the canonical real-world
> reference that proves PayCraft is genuinely SaaS-ready and not a thinly-veiled
> wrapper for one app's billing.

**Tenant:** reels-downloader (MobileByteLabs)
**PayCraft version:** v2.0.0 (cmp-paycraft `io.github.mobilebytelabs:cmp-paycraft:2.0.0`)
**Targets in production:** Android (Play Store) · iOS (App Store) · Web · Desktop
**First production transaction:** 2026-04-26

---

## Why this matters

reels-downloader is **not** the PayCraft team's pet project — it is the
canonical adopter. If a tenant cannot ship Stripe Connect onboarding, attach a
product, charge a customer, hear the webhook, and gate the SDK, PayCraft is
not a SaaS yet.

This document walks the **end-to-end** flow we used. Any adopter should be
able to follow it verbatim, swap "reels-downloader" with their tenant name,
and reach the same outcome.

---

## Step 1 — Sign up + create tenant

```text
Open https://paycraft.mobilebytesensei.com
  → Click "Sign in with Google"
  → Land on /onboarding (tenant-bootstrap wizard)
  → Pick a tenant slug: reels-downloader
  → Pick tier: Free  (will upgrade to Pro after Stripe activation)
```

What the dashboard does behind the scenes:

1. Inserts a row into `tenants` (id=auto-uuid, slug=`reels-downloader`,
   owner_user_id=<your Supabase auth uid>).
2. Inserts a row into `tier_definitions` link with `tier='free'`.
3. Issues an initial `pk_test_*` API key (rotateable later).

---

## Step 2 — Connect Stripe Connect (one-click OAuth)

```text
Dashboard → Settings → Providers → Stripe → "Connect with Stripe"
  → Land on Stripe Connect OAuth screen
  → Sign in to your Stripe account (or create one)
  → Approve "Allow PayCraft to read/write payments on your behalf"
  → Redirect back to /settings/providers
  → tenant_providers row created (stripe_account_id stored, secrets encrypted)
```

**No keys typed in chat.** The OAuth handshake pulls `access_token` /
`refresh_token` over the OAuth callback, encrypts them via pgsodium, and stores
in `tenant_stripe_connect`. From this point, all Stripe API calls PayCraft
makes on behalf of reels-downloader carry the `Stripe-Account` header
automatically.

---

## Step 3 — Webhook URL (one-time setup)

Stripe needs to know where to POST events. Set this in the Stripe Dashboard
(or via Stripe MCP if you have it wired):

```
URL:         https://paycraft.mobilebytesensei.com/api/webhooks/stripe
Events:      customer.subscription.created
             customer.subscription.updated
             customer.subscription.deleted
             invoice.payment_succeeded
             invoice.payment_failed
             payment_intent.succeeded
             payment_intent.payment_failed
             charge.refunded
Tenant tag:  reels-downloader   (Stripe Connect handles tenant routing
                                 via the Connect account_id automatically)
```

Stripe shows you a `whsec_*` signing secret. Copy it once and paste it into
the dashboard's "Webhook Secret" field. PayCraft encrypts it (pgsodium) and
stores at `tenant_providers.webhook_secret_enc`.

---

## Step 4 — Create your product + price

```text
Dashboard → Products → "New Product"
  → Name: reels-downloader Premium
  → Description: Unlimited downloads + ad-free + offline mode
  → Add price: $4.99 USD / month (recurring, no trial)
  → Add price: $39.99 USD / year (recurring, no trial)
  → Save
```

Behind the scenes:

1. PayCraft calls `POST /v1/products` on Stripe (via the tenant's Connect token).
2. Stripe responds with `prod_*` and `price_*` IDs.
3. PayCraft mirrors them into `tenant_products` (so your SDK can look them up
   by stable internal ID, not Stripe's).

---

## Step 5 — Wire `cmp-paycraft` into the app

In your KMP `commonMain` source set:

```kotlin
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.core.BillingManager

class ReelsDownloaderApp {
    fun onAppStart() {
        PayCraft.initialize(
            apiKey = BuildConfig.PAYCRAFT_API_KEY,   // pk_live_* in release
            backend = PayCraftBackend.Cloud,
        )
    }
}

// Anywhere you need to gate a premium feature:
suspend fun onDownloadClicked(url: String, uid: String) {
    if (BillingManager.isPremium(uid = uid)) {
        downloadFullQuality(url)
    } else {
        showPaywall()
    }
}
```

That's it. `isPremium` is cache-first; the SDK hits PayCraft only when its
TTL expires (weekly default, hourly during trial).

---

## Step 6 — End-user purchase flow

User experience inside the reels-downloader app:

```text
User taps "Upgrade to Premium"
  → reels-downloader calls BillingManager.startCheckout(planId = "monthly")
  → cmp-paycraft opens a Stripe-hosted checkout URL in an in-app browser tab
  → User enters card details on Stripe's UI (PayCraft never sees the card)
  → Stripe processes the payment
  → Stripe sends three webhooks to paycraft.mobilebytesensei.com:
      1. payment_intent.succeeded
      2. customer.subscription.created
      3. invoice.payment_succeeded
  → PayCraft's edge function verifies signature, persists each event,
    updates `subscriptions.status = active`
  → BillingManager.refreshStatus(force=true) is called by the app after
    the checkout tab closes
  → Cache hits, isPremium returns true on the next call
  → reels-downloader unlocks the feature
```

End-to-end latency in production: webhook arrives within 1-3 seconds of
checkout completion; cache refresh + UI update completes within another 200 ms
on a typical mobile network.

---

## Step 7 — Trial verification

reels-downloader optionally offers a 7-day trial. The trial-sticky-fields
contract lets us prove this works:

```kotlin
val state = BillingManager.getSubscriptionState(uid = "user@example.com")
val isTrialing = state.trialEndsAt != null &&
                 state.trialEndsAt > Clock.System.now()

if (isTrialing) {
    showBanner("Trial ends in ${state.trialDaysRemaining} days")
}
```

Even after the trial ends and the user converts to paid, `trialStartedAt`
and `trialEndedAt` persist on the `subscriptions` row — useful for cohort
analytics ("how many trial users converted?") without writing custom Stripe
queries.

---

## What we verified end-to-end (proof points)

| Proof point | Where verified | Result |
|---|---|---|
| Tenant signup creates a row | `tenants` table | ✅ |
| Stripe Connect OAuth completes without secrets typed | `tenant_providers.stripe_account_id` populated | ✅ |
| Webhook signature verification | `stripe-webhook` edge function logs | ✅ |
| Subscription lifecycle (created → active → canceled) | `subscriptions.status` transitions | ✅ |
| `isPremium` returns true within 5 seconds of `invoice.payment_succeeded` | reels-downloader Android E2E test | ✅ |
| Trial-sticky-fields survive renewal | `trialEndedAt` persists after `invoice.payment_succeeded` (post-trial) | ✅ |
| RLS prevents tenant A reading tenant B's subscriptions | `__tests__/api/rls-isolation.test.ts` | ✅ |
| Webhook idempotency (Stripe retry → same `subscriptions` state) | `idempotency_keys` table | ✅ |
| Refund flow (`charge.refunded`) downgrades `subscriptions.status` | reels-downloader manual test | ✅ |

---

## Cost the day we shipped

- Supabase Free: 500 MB DB, 2 GB egress, 50K MAU — **\$0**
- Vercel Hobby: 100 GB bandwidth, unlimited deploys — **\$0**
- Stripe: 2.9% + \$0.30 per successful transaction (pass-through) — **\$0 fixed**
- Resend Free: 100 emails/day, 3K/month — **\$0**
- Cloudflare R2 Free: 10 GB storage, 10M reads/mo — **\$0**

reels-downloader's PayCraft tab in our financial reconciliation: **\$0/mo
infra** at current ARR. PayCraft itself bills reels-downloader the same way
it bills any tenant — by dogfooding Stripe Connect (see RESEARCH.md D4).

---

## Anti-patterns we hit (so you don't)

1. **Webhook secret typed into Vercel UI.** Initial setup pre-vault. Migrated
   to vault alias `mbs-reels-downloader-stripe-webhook-secret` on
   2026-05-02. Lesson: **vault first, deploy second**.

2. **`PayCraft.initialize` called in a Compose `@Composable`.** Recomposed
   on every state change, hitting rate limits. Moved to `Application.onCreate`.

3. **`BillingManager.refreshStatus(force=true)` on every screen open.**
   Wasted API calls; relied on the cache instead. The SDK already invalidates
   on `WebView` close after checkout.

4. **No idempotency_key on retried webhooks.** Stripe retries the same event
   for ~3 days. We accidentally re-created the same `subscriptions` row twice
   before adding the dedup column. Now: `(provider_event_id)` is unique-indexed.

---

## Related docs

- `cmp-paycraft/README.md` — SDK install + API
- `docs/SECURITY.md` — Encryption, RLS, key rotation
- `docs/PCI_SCOPE.md` — SAQ-A scope statement
- `docs/DR_RUNBOOK.md` — Backup + restore procedure
- `dashboard/app/(marketing)/legal/dpa/page.tsx` — Sub-processor list
- `RESEARCH.md` D4 — Why PayCraft uses PayCraft (Stripe Connect dogfooding)
- `GOAL.md` AC57-AC63 — Phase 5 acceptance criteria covering this doc

---

**Doc owner:** Rajan Maurya (founder)
**Last verified end-to-end:** 2026-06-17
