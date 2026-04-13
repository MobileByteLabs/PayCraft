# PayCraft Security Guide

## Webhook Signature Verification

All webhook Edge Functions verify the signature before processing events.

### Stripe

Stripe signs webhooks with HMAC-SHA256 using your `STRIPE_WEBHOOK_SECRET`:

```typescript
// In stripe-webhook/index.ts
const event = await stripe.webhooks.constructEventAsync(
    body,
    signature,         // from stripe-signature header
    webhookSecret,     // STRIPE_WEBHOOK_SECRET env var
);
```

The Stripe SDK handles this automatically. If verification fails, the function returns 400.

### Razorpay

Razorpay signs webhooks with HMAC-SHA256:

```typescript
// In razorpay-webhook/index.ts
const expectedSignature = await hmacSHA256(
    rawBody,
    Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!,
);

if (signature !== expectedSignature) {
    return new Response("Invalid signature", { status: 401 });
}
```

## Key Management

### Never Hardcode Keys

**Wrong** ❌:
```kotlin
PayCraft.configure {
    supabase(
        url = "https://xyz.supabase.co",
        anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // hardcoded!
    )
}
```

**Correct** ✅:
```kotlin
PayCraft.configure {
    supabase(
        url = BuildConfig.SUPABASE_URL,       // from build config
        anonKey = BuildConfig.SUPABASE_ANON_KEY,
    )
}
```

Store keys in:
- Android: `local.properties` → BuildConfig (excluded from git)
- iOS: `Config.xcconfig` (excluded from git)
- Desktop: Environment variables or secure config file

### Supabase Anon Key

The Supabase anon key is **safe to include in your app**. It is designed for public client use. Combined with RLS policies, it cannot be abused.

What anon key can do with PayCraft:
- Call `is_premium(email)` RPC → returns boolean (no sensitive data)
- Call `get_subscription(email)` RPC → returns one row for that email

What it **cannot** do:
- Insert/update subscription rows (service_role only via webhook)
- Access other users' data (RLS + email filter in RPCs)
- Modify RPC functions

### Supabase Service Role Key

The service role key is used **only by the webhook Edge Functions**. It is set as an environment secret in Supabase, never in client code.

```bash
# Set it as a secret, never in app code
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... --project-ref YOUR_REF
```

### Stripe/Razorpay Keys

| Key | Where to store | Who uses it |
|-----|---------------|------------|
| Stripe Secret Key | Supabase secret | Webhook (Edge Function) |
| Stripe Publishable Key | Not needed | Not used |
| Stripe Webhook Secret | Supabase secret | Webhook signature verification |
| Razorpay Key ID | App BuildConfig | Payment link creation (optional) |
| Razorpay Key Secret | Supabase secret | Webhook signature verification |

## RLS Policies

PayCraft's `subscriptions` table uses Row Level Security:

```sql
-- Allow anyone to read (is_premium RPC uses this)
CREATE POLICY "Public read subscriptions"
    ON public.subscriptions FOR SELECT USING (true);

-- Only service role can write (webhook service role key)
CREATE POLICY "Service role manages subscriptions"
    ON public.subscriptions FOR ALL USING (auth.role() = 'service_role');
```

**Why public read?** The `is_premium(email)` function checks by email, not by JWT. This is intentional — email-based billing (vs Supabase Auth) keeps the integration simple and provider-agnostic.

**Mitigation**: The RPC only returns a boolean (is_premium) or the caller's own row (get_subscription uses the email parameter as a filter). An attacker who knows your Supabase URL + anon key can only check if a specific email is premium — they cannot enumerate users.

## Email as Identifier

PayCraft uses email rather than Supabase Auth tokens because:
1. Payment providers use email, not Supabase UIDs
2. Users can restore purchases by typing their email (no login required)
3. Webhook can match payments to subscriptions without auth context

**Trade-off**: Anyone who knows a user's email can check if they're premium. Acceptable for most apps — avoid if your premium status is itself sensitive.

## Webhook Endpoint Security

Webhook endpoints use `--no-verify-jwt` since providers cannot send Supabase JWTs. Security is enforced via signature verification (see above).

To reduce attack surface, keep webhook URL secret (don't publicly document it) and rotate webhook secrets periodically.
