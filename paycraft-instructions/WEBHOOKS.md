example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# WEBHOOKS.md — endpoints, verification discipline, reachability probe

> Consumed by `/idea-paycraft` chain step 3. Authored by `/paycraft-dev fold`.

Webhooks are how Supabase learns the truth. The app never learns entitlement from a provider; it
reads Supabase, and these functions keep Supabase correct.

## Deployed edge functions

| Function | Source | Role |
|---|---|---|
| `config` | — | Serves `SuiteConfig` to the SDK (`{backend}/functions/v1/config`) |
| `billing` | — | Billing operations surface |
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
| `otp-send-hook` | Supabase Auth | OTP delivery (Gate 2) |
| `stripe-connect-oauth` | Stripe | Connect onboarding |
| `webhook-health` | — | Reachability + last-delivery probe |
| `send-welcome`, `tenant-alerts`, `support-to-linear` | — | Notification/ops side-channels |

Shared engine under `supabase/functions/_shared/`: `entitlement-reconcile.ts` (canonical mapping +
one reconciled record), `receipt-validate.ts` (replay guard), `play-jwt.ts` (service-account JWT).

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
