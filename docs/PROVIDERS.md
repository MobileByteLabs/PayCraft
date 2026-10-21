# PayCraft — Supported Providers

## Stripe (Recommended)

The most feature-complete provider integration.

### Setup

1. Create Stripe account at stripe.com
2. Create Products in Stripe Dashboard → Products
3. Create Payment Links for each product
4. Optionally enable Customer Portal (for subscription management)

### Configuration

```kotlin
StripeProvider(
    paymentLinks = mapOf(
        "monthly"   to "https://buy.stripe.com/...",
        "quarterly" to "https://buy.stripe.com/...",
        "yearly"    to "https://buy.stripe.com/...",
    ),
    customerPortalUrl = "https://billing.stripe.com/p/login/...",  // optional
)
```

The `customerPortalUrl` enables "Manage Subscription" which lets users cancel or update payment.

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Activate subscription |
| `customer.subscription.updated` | Update plan/status |
| `customer.subscription.deleted` | Cancel subscription |
| `invoice.payment_failed` | Mark as `past_due` |

### Email Prefilling

Stripe payment links support `?prefilled_email=email@example.com` — PayCraft automatically appends the user's email to the checkout URL, reducing friction.

---

## Razorpay

Well-supported for Indian markets (INR, UPI, cards, net banking).

### Setup

1. Create Razorpay account at razorpay.com
2. Create Payment Links for each plan
3. Configure webhook in Dashboard → Webhooks

### Configuration

```kotlin
RazorpayProvider(
    paymentLinks = mapOf(
        "monthly"   to "https://rzp.io/l/...",
        "quarterly" to "https://rzp.io/l/...",
        "yearly"    to "https://rzp.io/l/...",
    ),
    dashboardUrl = "https://dashboard.razorpay.com/app/subscriptions",  // optional
)
```

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `payment.captured` | Activate subscription |
| `subscription.activated` | Activate subscription |
| `subscription.charged` | Renew subscription |
| `subscription.cancelled` | Cancel subscription |

---

## Custom Provider

Bring your own payment provider — any provider with payment links and webhooks works.

```kotlin
CustomProvider(
    name = "paddle",
    checkoutUrlBuilder = { plan, email ->
        "https://checkout.paddle.com/product/${plan.id}"
            .let { if (email != null) "$it?email=$email" else it }
    },
    manageUrlBuilder = { email ->
        "https://vendors.paddle.com/subscriptions?email=$email"
    },
    webhookFunctionName = "paddle-webhook",
)
```

You must also create the webhook Edge Function at `server/functions/paddle-webhook/index.ts`. See [Adding a New Provider](#adding-a-new-provider).

---

## Consumables & one-time products — provider support

> **Scope, deliberately.** Consumables are implemented for **five providers only**:
> `stripe`, `razorpay`, `cashfree`, `google_play`, `app_store`. Every other webhook in
> `supabase/functions/` is **subscription-only and intentionally left unimplemented** for
> consumables. See [Not implemented](#not-implemented-for-consumables) for why, and for what a
> future implementer needs.

A consumable (coin pack, credits) differs from a subscription in two places, and both must be
built for a provider to count as supported:

| half | what it does | where |
|---|---|---|
| **sync** | create the sellable product on the provider | `lib/*-product-sync.ts`, dispatched by `runProductSync` |
| **grant** | credit the buyer's balance when the purchase settles | `_shared/consumable-handler.ts`, called from that provider's webhook |

A provider with only the sync half sells a pack that credits nothing. A provider with only the
grant half has nothing to sell. Neither half alone is "support".

### Implemented

| provider | sync (product created as) | grant (event → identifier) |
|---|---|---|
| `stripe` | one-time Price + Payment Link | `checkout.session.completed` (payment mode) → `metadata.plan_id` |
| `razorpay` | Payment Link | `payment.captured` → `notes.paycraft_product_id` |
| `cashfree` | Payment Link (one-time-only lane) | `PAYMENT_SUCCESS_WEBHOOK` → product resolved from `link_id` prefix |
| `google_play` | managed product (`inappproducts`) | RTDN `oneTimeProductNotification` type 1 → `sku` + `purchaseToken` |
| `app_store` | in-app purchase (`/v2/inAppPurchases`) | ASSN `ONE_TIME_CHARGE` → `productId` + `transactionId` |

Only these five are **connectable** — `tenant_providers` constrains credentials to
`stripe | razorpay | cashfree` plus the `google_play | app_store` store kinds — so these are also
the only providers `paycraft_sync_product` can create a product on.

> **One inbound attribution rule, for every provider and both product kinds.**
>
> Outbound (the v1 API and MCP) is account-authenticated: an account access token plus the app's
> api key, and `requireApiKey` refuses to act on an app the key does not reach. Inbound traffic has
> no key — the provider calls us — so the app is recovered from the event. That asymmetry is real.
> Three *different* recoveries were not, and `_shared/inbound-tenant.ts` now replaces them:
>
> | order | how | used by |
> |---|---|---|
> | 1 | tenant in the webhook URL path | the web PSPs |
> | 2 | app identifier → `tenants.app_identifier` | Play `packageName`, Apple `bundleId` |
> | 3 | sole tenant configured for that provider (warns) | any lane missing 1 and 2 |
> | 4 | `null` — genuine single-tenant self-hosted | any |
>
> More than one candidate at step 3 is **ambiguous and refused**, because crediting the wrong app's
> ledger is worse than failing a webhook the provider will redeliver.
>
> This also fixed a real defect: the store lanes previously reconciled every subscription with
> `tenant_id: null`, and a NULL-tenant row never matches `check_premium_with_device()`'s
> `tenant_id IS NOT DISTINCT FROM` filter — so `is_premium` read **false for a paying customer** on
> any multi-tenant deployment. Play and App Store subscriptions are now attributed by the same rule
> as their consumables.
>
> Resolving on the PRODUCT id is deliberately not one of the steps: two tenants can both sell a sku
> called `coins_550`, so a product-only lookup either errors on multiple rows or silently
> mis-attributes.
>
> The buyer on a store purchase is the app's OWN user id — Play's `obfuscatedExternalAccountId`,
> Apple's `appAccountToken` — recorded as `kind: "auth_user"`, `verified: true`. A purchase with no
> account id is refused rather than attributed to the purchase token, which would mint a throwaway
> subject the buyer can never sign back into.
>
> A consumable is **re-buyable without limit**: Play consumes it and Apple marks it CONSUMABLE, so
> each purchase arrives with its own token / `transactionId` — which is why the idempotency key is
> keyed on that and never on the product.

### The grant contract

`handleConsumablePurchase` is provider-agnostic on purpose: the per-provider differences are only
*which event means paid*, *where the product identifier lives*, and *what the stable transaction id
is*. How much to grant is never a provider decision — it is read from `tenant_products
.grant_quantity`, because a webhook payload can be stale after a catalogue edit and is
attacker-adjacent on self-hosted deployments.

```ts
await handleConsumablePurchase({
  tenantId,                     // from the webhook URL path; null is refused
  email,                        // buyer identity — resolved to an entitlement subject
  productId,                    // PayCraft product UUID  …or…
  sku,                          // catalogue sku — whichever the provider round-trips
  stableTxnId,                  // THE idempotency anchor; null is refused
  provider,                     // prefixes the idempotency key
  eventType,
})
```

Three rules a new provider must satisfy:

1. **A stable per-purchase id.** The key is `provider:stableTxnId`, and a redelivery must present
   the same one. Cashfree is the cautionary case: its `link_id` is reused across every purchase of
   a product, so keying on it would make the *second* buyer look like a redelivery of the first and
   silently grant them nothing. Its **order id** is the correct anchor.
2. **A product identifier that survives the round trip.** Either the sku or the UUID — the handler
   accepts both, so existing integrations do not have to be rewritten to agree on one.
3. **Route before the subscription handler.** A consumable sent to `handleSubscriptionEvent` grants
   *access* instead of currency. Stripe did exactly this: a pack became a lifetime entitlement row
   and the balance stayed at zero.

### Not implemented for consumables

`paddle` · `paystack` · `lemonsqueezy` · `flutterwave` · `midtrans` · `paypal` · `btcpay`

These are webhook-only providers: they have no entry in `tenant_providers`, so PayCraft never
creates a product on them, and the catalogue row they reference is configured in the provider's own
dashboard. They are **not** blocked by anything in the shared handler — each is roughly fifteen
lines of wiring once the piece below is known.

**What is missing is not code — it is the metadata contract.** Each provider carries a merchant
reference through checkout under a different field, and PayCraft's checkout lane does not currently
set one for these providers. Wiring a grant without knowing that field means guessing which key the
sku arrives under, and a wrong guess is a purchase that charges the customer and credits nothing.

So an implementer needs, per provider:

| provider | one-time event (identified, not verified) | unknown |
|---|---|---|
| `paddle` | `transaction.completed` | which `custom_data` key carries the product ref |
| `paystack` | `charge.success` with no `plan_code` | `metadata` key |
| `lemonsqueezy` | `order_created` | `meta.custom_data` key |
| `flutterwave` | `charge.completed` with no `payment_plan` | `meta` key |
| `midtrans` | `capture` / `settlement` | which `custom_field*` carries it |
| `paypal` | `PAYMENT.CAPTURE.COMPLETED` | whether `custom_id` or `invoice_id` is used |
| `btcpay` | `InvoiceSettled` | invoice `metadata` key |

The events above were read from each handler and are a sound starting point. The **unknown** column
is the part that must be confirmed against a real checkout before wiring — ideally by making
PayCraft's own checkout set the field, so the contract is owned rather than discovered.

When adding one, the failure mode to preserve is the safe one: an unrecognised identifier makes
`handleConsumablePurchase` refuse with `"no sku or product id"` and log it, rather than grant the
wrong product.

---

## Adding a New Provider

Run `/add-provider` in Claude Code, or follow these steps manually:

### 1. Implement PaymentProvider

Create `cmp-paycraft/src/commonMain/kotlin/.../provider/[Name]Provider.kt`:

```kotlin
class [Name]Provider(
    private val paymentLinks: Map<String, String>,
    private val managementUrl: String? = null,
) : PaymentProvider {
    override val name = "[name]"
    override val webhookFunctionName = "[name]-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?) =
        paymentLinks[plan.id] ?: error("No payment link for '${plan.id}'")

    override fun getManageUrl(email: String) = managementUrl
}
```

### 2. Create Webhook Edge Function

Create `server/functions/[name]-webhook/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

serve(async (req) => {
    // 1. Verify webhook signature from provider
    const secret = Deno.env.get("[NAME]_WEBHOOK_SECRET")!;
    // ... verify HMAC ...

    const body = await req.json();

    // 2. Map provider event to subscription data
    if (body.event === "subscription.active") {
        await handleSubscriptionEvent({
            email: body.subscriber.email,
            provider: "[name]",
            customerId: body.subscriber.id,
            subscriptionId: body.subscription.id,
            plan: body.subscription.plan_id,
            status: "active",
            periodStart: new Date(body.subscription.start_date),
            periodEnd: new Date(body.subscription.end_date),
            cancelAtPeriodEnd: false,
        });
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
});
```

### 3. Update PROVIDERS.md

Document the new provider with setup instructions.

---

## Provider Comparison

| Feature | Stripe | Razorpay | Custom |
|---------|:------:|:--------:|:------:|
| Setup time | 10 min | 10 min | 30 min |
| Claude skill | ✅ `/setup-stripe` | ✅ `/setup-razorpay` | ❌ Manual |
| Payment link prefill | ✅ Email | ❌ | Depends |
| Customer portal | ✅ Full portal | ❌ Dashboard only | Depends |
| India UPI/cards | ❌ | ✅ | Depends |
| Global coverage | ✅ | Limited | Depends |
| Free tier | ✅ | ✅ | Depends |
