---
sidebar_position: 4
---

# Webhook Flow

Webhooks are how PayCraft stays in sync with payment providers. When a customer pays, cancels, or renews, the provider sends a webhook to your Supabase Edge Function.

## Flow

```
Customer pays on Stripe Checkout
    |
    v
Stripe sends POST to your Edge Function
    |
    v
Edge Function verifies signature (HMAC-SHA256)
    |
    v
Extracts: email, plan, status, period_start, period_end
    |
    v
Upserts into `subscriptions` table (Supabase)
    |
    v
Next time app calls check_premium_with_device()
    -> reads updated row -> returns is_premium: true
```

## Handled Events

| Stripe Event | Action |
|-------------|--------|
| `checkout.session.completed` | Create/update subscription (active) |
| `customer.subscription.updated` | Update status, period, cancel_at_period_end |
| `customer.subscription.deleted` | Mark as canceled |
| `invoice.paid` | Renew subscription (active) |

## Webhook Security

- Signature verified using mode-specific secrets (test vs live)
- No fallback chain -- wrong mode = 400 error
- Edge Functions run server-side (service_role key, never exposed to clients)
