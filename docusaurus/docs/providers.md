---
sidebar_position: 7
---

# Providers

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
