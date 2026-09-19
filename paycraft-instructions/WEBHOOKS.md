example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

# WEBHOOKS.md — endpoints, verification discipline, reachability probe

> Consumed by `/idea-paycraft` chain step 3. Authored by `/paycraft-dev fold`.

Webhooks are how Supabase learns the truth. The app never learns entitlement from a provider; it
reads Supabase, and these functions keep Supabase correct.

## Deployed edge functions

| Function | Source | Role |
|---|---|---|
| `config` | — | Serves `SuiteConfig` to the SDK (`{backend}/functions/v1/config`) |
| `billing` | — | Billing operations surface |
| `checkout-initiate` | SDK client | Mints a **per-customer** checkout where no reusable link can exist |
| `account-token` | headless caller | Exchanges an account API key for a short-lived owner JWT |
| `stripe-webhook` | Stripe | Subscription lifecycle |
| `razorpay-webhook` | Razorpay | Subscription lifecycle |
| `paddle-webhook` | Paddle | Subscription lifecycle |
| `paypal-webhook` | PayPal | Subscription lifecycle |
| `paystack-webhook` | Paystack | Subscription lifecycle |
| `flutterwave-webhook` | Flutterwave | Subscription lifecycle |
| `lemonsqueezy-webhook` | LemonSqueezy | Subscription lifecycle |
| `midtrans-webhook` | Midtrans | Subscription lifecycle |
| `cashfree-webhook` | Cashfree | Subscription lifecycle |
| `btcpay-webhook` | BTCPay | Subscription lifecycle |
| `google-rtdn` | Google Play | Real-time Developer Notifications via a Pub/Sub **push** subscription |
| `apple-server-notifications` | Apple | App Store Server Notifications V2 |
| `register-play-purchase` | SDK client | Play grant endpoint — client posts `purchaseToken` |
| `register-appstore` | SDK client | Apple mirror of the grant endpoint |
| `cloud-billing-webhook` | PayCraft Cloud | Tenant-plan billing |
| `coupon-validate` | SDK client | Coupon validation |
| `stripe-connect-oauth` | Stripe | Connect onboarding |
| `webhook-health` | — | Reachability + last-delivery probe |
| `send-welcome`, `tenant-alerts`, `support-to-linear` | — | Notification/ops side-channels |

> **`otp-send-hook` was REMOVED** with the OTP ownership gate on 2026-09-06
> (BILLING_STATE_SEMANTICS.md). A deploy list or probe that still expects it is checking for a
> function that no longer exists.

Shared engine under `supabase/functions/_shared/`: `entitlement-reconcile.ts` (canonical mapping +
one reconciled record), `receipt-validate.ts` (replay guard), `play-jwt.ts` + `apple-jwt.ts`
(store-API JWTs), `account-key.ts` (account API-key hashing/verification), `tier-gate.ts`,
`rate-limit.ts` / `webhook-rate-limit.ts`, `pricing-shadow.ts`, `country-code.ts`,
`supabase-admin.ts`, `subscription-handler.ts`, `email.ts`.

## The three invariants every webhook honours

1. **Never trust the request body.** Both Play paths (`google-rtdn`, `register-play-purchase`)
   re-fetch truth from the Play Developer API
   (`purchases.subscriptionsv2.get`) using a service-account JWT. The notification/body is a
   *signal that something changed*, never the change itself. Apple paths verify the JWS and re-fetch
   through the App Store Server API.
2. **Reject replay.** `assertPlayTokenNotReused` refuses a `purchaseToken` already bound to a
   different `app_user_id` — the token-theft / receipt-sharing case.
3. **Reconcile to ONE canonical record.** Every path funnels into `reconcileEntitlement` with a
   provider-specific `*ToCanonical` mapper, so the same subscription never produces two competing
   rows with different vocabularies.

### `register-play-purchase` contract

```
POST { purchase_token, product_id, app_user_id, package_name, api_key? }
200  { entitlement: EntitlementDto }
4xx/5xx { error: string }
```

Steps: re-fetch from the Play Developer API → replay guard → reconcile → return the reconciled
entitlement in the SDK's wire shape so the client can unlock immediately without a second round-trip.

`register-appstore` is the Apple mirror: JWS verify → replay guard → App Store Server API re-fetch →
reconcile.

### `checkout-initiate` — why a per-customer lane had to exist

A Razorpay recurring plan has **no reusable payment link**, by design: an auth link authorises ONE
customer's mandate, so it carries their contact details. At catalogue-sync time there is no customer,
which is why product sync answers *"The contact field is required for recurring links"* and
`tenant_providers.live_payment_links` stays `{sku:{}}` for subscriptions no matter how often an
operator re-syncs.

The per-customer lane already existed in the dashboard — but behind `requireTenant()`, a **cookie
session**, while the SDK holds a publishable api key. So the SDK could not reach it, fell back to
payment links a subscription will never have, and the paywall's Continue button threw *"no checkout
URL for currency INR"* on device with nothing connecting the two facts. This function is that lane,
authenticated the way the SDK actually authenticates: the same `resolve_tenant(apiKey)` +
per-tenant rate limit `/config` uses. **The tenant's provider secret never leaves the server** — it
is decrypted in-function via `tenant_providers_decrypt_key` (SECURITY DEFINER, granted to
`service_role`).

The lesson generalises: an empty `payment_links` map for a recurring SKU is not necessarily a sync
failure to retry. Check whether the provider can *have* a reusable link for that product type before
treating it as drift.

### `account-token` — headless authorization without widening the surface

PayCraft's mutating RPCs authorize on `auth.uid()` through `tenant_admins`, so acting as an account
used to require a human-held session. This exchanges an account API key (`sk_acct_…`) for a
short-lived JWT carrying `sub = owner_user_id`, `role = authenticated` — so every existing RPC, RLS
policy and `auth.uid()` guard keeps working exactly as audited, and the anon surface that migrations
105/107 swept stays swept.

Both rejected alternatives are worth remembering, because both are the obvious shortcut: calling
`service_role` from an edge function bypasses RLS entirely and makes that one function the sole
security boundary for every table it can reach; a caller-supplied owner parameter is precisely the
caller-asserted identity migration 107 existed to remove.

It also carries a deployment constraint: **no third-party JWT library.** A `deno.land/x` import in
the bundle path once stopped `stripe-connect-oauth` deploying while the other 24 functions shipped.
HS256 is a hash, a concat and a base64url encode, and the platform's own WebCrypto has no version to
rot.

## Provider-side registration each webhook needs

| Path | Register where |
|---|---|
| `google-rtdn` | Play Console → Monetization setup → RTDN topic, with this function URL as the Pub/Sub **push** endpoint |
| `apple-server-notifications` | App Store Connect → App Information → App Store Server Notifications V2 URL |
| provider webhooks | each provider's dashboard → webhook/endpoint settings, subscribed to subscription lifecycle events |

Signing secrets and service-account credentials live in the vault and reach the functions as
Supabase function secrets — never in client source. See KEY_TIERING.md.

## Reachability probe contract

`/idea-paycraft` asserts each **applicable** webhook is *healthy*, defined as all of:

1. **Deployed** — the function exists in the project's function list.
2. **Reachable** — an unsigned/synthetic request reaches it and is answered (a signature rejection is
   a healthy answer; a 404 or a connection failure is not).
3. **Registered** — the provider side points at this URL.
4. **Delivering** — `webhook-health` reports a recent successful delivery where one is expected.

Applicability is derived from the app's actual lanes: an Android-only app with no web provider needs
`google-rtdn` + `register-play-purchase` + `config`, and must not be failed for an absent
`stripe-webhook`.

A probe that cannot complete because of a missing credential or an unconfigured provider account is
an **external gate** — reported with its reason and logged, never faked green and never spun on.
