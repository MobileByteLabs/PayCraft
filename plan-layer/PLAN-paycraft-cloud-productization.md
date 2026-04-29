# Plan: PayCraft Cloud — Productization Roadmap

> **ID**: PLAN-paycraft-260429-072534
> **Status**: Code Complete — Ready for Deployment
> **Scope**: mbs/PayCraft
> **Created**: 2026-04-29
> **Updated**: 2026-04-30
> **Project Plan**: `workspaces/mbs/PayCraft/plan-layer/PLAN-paycraft-cloud-productization.md`
> **Approach**: Free-tier-first — $0/month until first paying customer

## Context

PayCraft v1.4.0 is a provider-agnostic KMP billing library (6 platforms, Maven Central) used internally at MobileByteSensei. The architecture is clean: App -> PayCraft SDK -> Supabase <- Webhooks <- Payment Providers. We want to turn it into a developer-facing product: **open-source SDK + optional hosted backend** (like RevenueCat or Supabase's model).

**Differentiators**: Multi-provider (not locked to Stripe), KMP native, self-hosted option, device binding built-in, works outside app stores.

**Current gap**: No multi-tenant support, no web dashboard, docs not public-ready.

---

## Infrastructure Strategy: Free-Tier-First

All infrastructure runs on free tiers until revenue justifies upgrades. $0/month to launch.

### Free Tier Stack

| Service | Free Tier Limits | Role |
|---------|-----------------|------|
| **Supabase Free** | 500MB DB, 50K auth MAU, 500K Edge Function invocations, 1GB storage, 2 projects | Multi-tenant backend, webhooks, auth |
| **Vercel Hobby** | 1 project, 100GB bandwidth, serverless functions | Next.js dashboard hosting |
| **GitHub Pages** | Unlimited static hosting | Docusaurus docs site |
| **GitHub Actions** | 2,000 min/month | CI/CD pipelines |
| **Stripe** | No monthly fee, 2.9% + $0.30 per transaction | Payment processing (pay only when paid) |
| **Resend Free** | 3,000 emails/month | Tenant welcome emails, alerts |

### Capacity on Free Tier

| Resource | Free Limit | Supports |
|----------|-----------|----------|
| Database rows | ~500MB | ~200 tenants x 10K subscribers each |
| Auth users | 50K MAU | 50K dashboard logins/month |
| Edge Functions | 500K/month | ~500K webhook events/month |
| Bandwidth | 100GB/month | Normal dashboard + docs traffic |

### Upgrade Triggers

| Trigger | Action | New Cost |
|---------|--------|---------|
| DB pausing (7-day inactivity) | GitHub Actions weekly cron ping (free) | $0 |
| First paying customer | Upgrade Supabase to Pro | $25/month |
| Dashboard traffic spikes | Upgrade Vercel to Pro | +$20/month |
| >500 tenants | Upgrade Supabase to Team | $599/month |
| >3K emails/month | Upgrade Resend to Starter | +$20/month |

### Keep-Alive Cron (Free — Prevents Supabase Pausing)

```yaml
# .github/workflows/keep-alive.yml
name: Keep Supabase Alive
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly Sunday midnight UTC
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -sf "${{ secrets.SUPABASE_URL }}/rest/v1/" -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" > /dev/null
```

---

## Revenue Model

### Pricing Tiers (What We Charge Tenants)

| Tier | Subscriber Limit | Price | Our Marginal Cost |
|------|-----------------|-------|-------------------|
| **Free** | 100 subscribers | $0/month | ~$0.02/month |
| **Pro** | 10,000 subscribers | $29-49/month | ~$0.50/month |
| **Enterprise** | Unlimited | $199-499/month | ~$5/month |

### Break-Even Analysis

| Milestone | Revenue | Infra Cost | Margin |
|-----------|---------|-----------|--------|
| Launch (0 tenants) | $0 | $0 | -- |
| 1 Pro tenant | $49/month | $0 (still free tier) | 100% |
| Upgrade to Supabase Pro | -- | $25/month | -- |
| 2 Pro tenants | $98/month | $25/month | 74% |
| 10 Pro tenants | $490/month | $46/month | 91% |
| 50 Pro + 5 Enterprise | $3,945/month | $46/month | 99% |
| 500+ tenants (scale tier) | $20K+/month | $620/month | 97% |

### Stripe Processing Fees (On Our Billing)

| Tenant Tier | Stripe Takes | We Keep |
|-------------|-------------|---------|
| Pro $49/month | $1.72 (2.9% + $0.30) | $47.28 |
| Enterprise $299/month | $8.97 | $290.03 |
| Pro Annual $468 | $13.87 | $454.13 |

---

## Test Mode Architecture

Every tenant gets both test and live environments from day one. Test mode enables full E2E verification without real money.

### How Test Mode Works

```
Tenant signs up on dashboard
    |
    v
Auto-generated:
    - Test API Key:  pk_test_abc123...    (prefix: pk_test_)
    - Live API Key:  pk_live_abc123...    (prefix: pk_live_)
    - Test Webhook Secret: whsec_test_...
    - Live Webhook Secret: whsec_live_...
    |
    v
SDK detects mode from key prefix:
    PayCraft.configure {
        cloud("pk_test_abc123...")  // <-- test mode auto-detected
    }
```

### Test vs Live Isolation

| Aspect | Test Mode (`pk_test_*`) | Live Mode (`pk_live_*`) |
|--------|------------------------|------------------------|
| Supabase data | `subscriptions` WHERE `mode = 'test'` | `subscriptions` WHERE `mode = 'live'` |
| Stripe keys | Tenant's test secret key | Tenant's live secret key |
| Webhook URL | `/stripe-webhook/{tenant_id}?mode=test` | `/stripe-webhook/{tenant_id}` |
| Payment links | Stripe test payment links (4242 card) | Real payment links |
| Dashboard view | Toggle: "Test Data" / "Live Data" | Default view |
| Subscriber limit | Unlimited (no limit enforcement in test) | Free: 100 / Pro: 10K |

### Schema Change

Migration `014_add_mode_column.sql`:
```sql
ALTER TABLE subscriptions ADD COLUMN mode TEXT NOT NULL DEFAULT 'live';
-- Index for fast filtering
CREATE INDEX idx_subscriptions_mode ON subscriptions(tenant_id, mode);

-- RPCs accept mode parameter, default 'live'
-- Test mode RPCs never count toward subscriber limit
```

### Test Mode in RPCs

All 8 RPCs gain an optional `p_mode` parameter (default `'live'`):
- SDK sends `mode = 'test'` when configured with `pk_test_*` key
- Pre-request function sets `SET LOCAL app.mode = 'test'`
- All queries add `AND mode = current_setting('app.mode')`
- `is_premium` in test mode always checks test subscriptions only
- Subscriber limit enforcement skips test mode rows

### Test Cleanup

Dashboard provides:
- "Clear Test Data" button — deletes all `mode = 'test'` rows for this tenant
- Auto-cleanup: test data older than 30 days auto-purged (Supabase cron — free)

### SDK Test Mode Detection

```kotlin
// PayCraft.kt — auto-detect from key prefix
fun cloud(apiKey: String) {
    this.apiKey = apiKey
    this.isTestMode = apiKey.startsWith("pk_test_")
    // Sets X-PayCraft-Mode: test|live header
}
```

---

## Email Notifications (Purchase Events)

Triggered by webhook processing. All emails sent via **Resend** (free: 3,000/month).

### Email Trigger Flow

```
Stripe webhook fires (subscription.created / updated / deleted)
    |
    v
Edge Function processes webhook:
    1. Upsert subscription in DB
    2. Check tenant's email_notifications config
    3. If enabled -> call Resend API
    |
    v
Resend sends email to:
    - End user (purchase confirmation, cancellation, renewal)
    - Tenant admin (new subscriber alert, churn alert)
```

### Email Events

| Event | Recipient | Template | Trigger |
|-------|-----------|----------|---------|
| Purchase confirmation | End user | "Welcome to {app_name} Premium!" | `subscription.created` |
| Renewal success | End user | "Your {plan_name} renewed for {period}" | `subscription.updated` (period change) |
| Cancellation | End user | "Your premium access until {period_end}" | `subscription.deleted` / `status=cancelled` |
| Payment failed | End user | "Payment failed — update card to keep access" | `invoice.payment_failed` |
| New subscriber | Tenant admin | "{email} subscribed to {plan}" | `subscription.created` |
| Churn alert | Tenant admin | "{email} cancelled {plan}" | `subscription.deleted` |
| Approaching limit | Tenant admin | "90/100 subscribers — upgrade to Pro" | Subscriber count threshold |

### Email Configuration (Per Tenant)

Migration `022_email_config.sql`:
```sql
CREATE TABLE tenant_email_config (
    tenant_id UUID REFERENCES tenants(id) PRIMARY KEY,
    -- Toggle email types
    send_purchase_confirmation BOOLEAN DEFAULT true,
    send_renewal_notification BOOLEAN DEFAULT true,
    send_cancellation_notice BOOLEAN DEFAULT true,
    send_payment_failed BOOLEAN DEFAULT true,
    send_admin_new_subscriber BOOLEAN DEFAULT true,
    send_admin_churn_alert BOOLEAN DEFAULT true,
    -- Customization
    from_name TEXT DEFAULT 'PayCraft',       -- e.g., "MyApp Team"
    reply_to TEXT,                            -- tenant's support email
    brand_color TEXT DEFAULT '#6366F1',       -- primary color for email template
    logo_url TEXT,                            -- tenant's logo in emails
    app_name TEXT NOT NULL,                   -- "MyApp Premium"
    -- Resend
    resend_api_key TEXT,                      -- tenant's own Resend key (Pro+)
    -- Free tier: uses PayCraft Cloud's shared Resend key
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Email Sending Architecture

```
Free tier tenants:
    Webhook -> Edge Function -> PayCraft Cloud Resend key (shared)
    From: noreply@paycraft.dev
    Limit: shared 3,000/month across all free tenants

Pro/Enterprise tenants:
    Webhook -> Edge Function -> Tenant's own Resend key
    From: noreply@{tenant-domain}  (custom sender)
    Limit: tenant's own Resend plan (unlimited)
```

### Implementation in Webhook Handler

```typescript
// server/functions/_shared/subscription-handler.ts
async function handleSubscriptionEvent(event, tenantId) {
    // 1. Upsert subscription (existing logic)
    await upsertSubscription(event, tenantId);

    // 2. Send email notification
    const emailConfig = await getEmailConfig(tenantId);
    if (!emailConfig) return; // emails not configured

    const resendKey = emailConfig.resend_api_key || PAYCRAFT_CLOUD_RESEND_KEY;
    const resend = new Resend(resendKey);

    switch (event.type) {
        case 'customer.subscription.created':
            if (emailConfig.send_purchase_confirmation) {
                await resend.emails.send({
                    from: `${emailConfig.from_name} <noreply@paycraft.dev>`,
                    to: event.data.object.customer_email,
                    subject: `Welcome to ${emailConfig.app_name}!`,
                    html: renderPurchaseEmail(event, emailConfig),
                });
            }
            if (emailConfig.send_admin_new_subscriber) {
                await resend.emails.send({
                    from: `PayCraft <alerts@paycraft.dev>`,
                    to: emailConfig.reply_to,
                    subject: `New subscriber: ${event.data.object.customer_email}`,
                    html: renderAdminNewSubEmail(event, emailConfig),
                });
            }
            break;
        // ... other event types
    }
}
```

---

## Provider API Key Storage (Security Architecture)

Tenant provider keys (Stripe secret key, Razorpay key, webhook secrets) are sensitive. They need encryption at rest.

### Storage Design

Migration `021_tenant_provider_config.sql`:
```sql
CREATE TABLE tenant_providers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) NOT NULL,
    provider TEXT NOT NULL,                    -- 'stripe', 'razorpay', 'paddle', etc.
    -- Encrypted fields (AES-256-GCM via pgcrypto)
    test_secret_key_enc BYTEA,               -- Stripe test secret key (encrypted)
    live_secret_key_enc BYTEA,               -- Stripe live secret key (encrypted)
    test_webhook_secret_enc BYTEA,           -- Test webhook signing secret (encrypted)
    live_webhook_secret_enc BYTEA,           -- Live webhook signing secret (encrypted)
    -- Non-sensitive config
    test_payment_links JSONB DEFAULT '{}',   -- { "monthly": "https://buy.stripe.com/test_xxx", ... }
    live_payment_links JSONB DEFAULT '{}',   -- { "monthly": "https://buy.stripe.com/xxx", ... }
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, provider)
);

-- RLS: only the tenant's own service_role can read their keys
ALTER TABLE tenant_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_providers_own" ON tenant_providers
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### Encryption Flow

```
Dashboard (HTTPS) -> Vercel API Route -> Supabase Edge Function
    |
    v
Edge Function encrypts with pgcrypto:
    SELECT pgp_sym_encrypt(
        'sk_live_xxx',
        current_setting('app.encryption_key')
    )
    |
    v
Stored as BYTEA in tenant_providers.live_secret_key_enc
    |
    v
On webhook receipt, Edge Function decrypts:
    SELECT pgp_sym_decrypt(
        live_secret_key_enc,
        current_setting('app.encryption_key')
    ) FROM tenant_providers
    WHERE tenant_id = {tenant_id} AND provider = 'stripe'
    |
    v
Uses decrypted key to verify Stripe webhook signature
```

### Encryption Key Management

```
PAYCRAFT_ENCRYPTION_KEY environment variable:
    - Stored in Supabase Edge Function secrets (NOT in DB)
    - Set via: supabase secrets set PAYCRAFT_ENCRYPTION_KEY=xxx
    - 256-bit random key: openssl rand -hex 32
    - Rotation: re-encrypt all rows with new key (migration script)
```

### What Gets Encrypted vs Plain

| Field | Encrypted? | Reason |
|-------|-----------|--------|
| Stripe secret key | YES (AES-256) | Can charge customers |
| Webhook signing secret | YES (AES-256) | Can forge webhook events |
| Payment links | NO (plain JSONB) | Public URLs, visible in HTML |
| Provider name | NO (plain TEXT) | Non-sensitive |
| is_active flag | NO (plain BOOLEAN) | Non-sensitive |

### Key Access Rules

| Actor | Can Read Keys? | Method |
|-------|---------------|--------|
| Tenant admin (dashboard) | Last 4 chars only (sk_...xxxx) | Masked display |
| Edge Functions (webhooks) | Full key (decrypted) | pgp_sym_decrypt |
| Supabase RLS (SDK) | NEVER | No policy grants access |
| PayCraft Cloud admin | NEVER | No service_role access to key columns |

---

## `/paycraft-adopt` Cloud Mode (One-Command Setup)

The existing `/paycraft-adopt` handles self-hosted setup. We extend it with a **Cloud mode** that automates everything end-to-end — developer just provides their Stripe/Razorpay keys.

### New Flow: `/paycraft-adopt --cloud`

```
Developer runs: /paycraft-adopt

    Step 1: Mode Selection
    ┌─────────────────────────────────────────┐
    │ PayCraft Setup                          │
    │                                         │
    │ [C] Cloud (hosted by PayCraft Cloud)    │
    │ [S] Self-Hosted (your own Supabase)     │
    │                                         │
    │ Choose mode:                            │
    └─────────────────────────────────────────┘

    If [C] Cloud:
        |
        v
    Step 2: Ask for PayCraft Cloud API Key
    ┌─────────────────────────────────────────┐
    │ Enter your PayCraft Cloud API Key:      │
    │ (Get one at dashboard.paycraft.dev)     │
    │                                         │
    │ > pk_test_abc123...                     │
    └─────────────────────────────────────────┘
        |
        v
    Step 3: Ask for Provider Keys
    ┌─────────────────────────────────────────┐
    │ Payment Provider Setup                  │
    │                                         │
    │ Which provider? [S] Stripe [R] Razorpay │
    │ > S                                     │
    │                                         │
    │ Stripe Test Secret Key:                 │
    │ > sk_test_xxx                           │
    │                                         │
    │ Stripe Live Secret Key (or skip):       │
    │ > sk_live_xxx                           │
    │                                         │
    │ Test Payment Links:                     │
    │   Monthly:  > https://buy.stripe.com/test_monthly    │
    │   Yearly:   > https://buy.stripe.com/test_yearly     │
    │                                         │
    │ Live Payment Links (or skip):           │
    │   Monthly:  > https://buy.stripe.com/live_monthly    │
    │   Yearly:   > https://buy.stripe.com/live_yearly     │
    └─────────────────────────────────────────┘
        |
        v
    Step 4: Auto-Configure Everything
    /paycraft-adopt handles ALL of this automatically:
        |
        +-- 4a. Validate API key against PayCraft Cloud
        |       curl POST /api/validate-key { key: "pk_test_..." }
        |       -> Returns: tenant_id, tenant_name, plan, webhook_url
        |
        +-- 4b. Upload provider keys to PayCraft Cloud (encrypted)
        |       curl POST /api/providers/configure {
        |           provider: "stripe",
        |           test_secret_key: "sk_test_xxx",
        |           live_secret_key: "sk_live_xxx",
        |           test_payment_links: {...},
        |           live_payment_links: {...}
        |       }
        |       Headers: X-PayCraft-API-Key: pk_test_abc123...
        |       -> Keys encrypted server-side, stored in tenant_providers
        |
        +-- 4c. Generate app code
        |       Writes PayCraftConfig.kt:
        |           object PayCraftConfig {
        |               const val CLOUD_API_KEY = "pk_test_abc123..."
        |               val TEST_PAYMENT_LINKS = mapOf(
        |                   "monthly" to "https://buy.stripe.com/test_monthly",
        |                   "yearly" to "https://buy.stripe.com/test_yearly",
        |               )
        |               val LIVE_PAYMENT_LINKS = mapOf(
        |                   "monthly" to "https://buy.stripe.com/live_monthly",
        |                   "yearly" to "https://buy.stripe.com/live_yearly",
        |               )
        |               val IS_TEST_MODE = true  // flip to false for production
        |           }
        |
        +-- 4d. Generate NetworkModule.kt init code
        |       Writes/updates initPayCraft():
        |           fun initPayCraft() {
        |               PayCraft.configure {
        |                   cloud(PayCraftConfig.CLOUD_API_KEY)
        |                   provider(StripeProvider(
        |                       testPaymentLinks = PayCraftConfig.TEST_PAYMENT_LINKS,
        |                       livePaymentLinks = PayCraftConfig.LIVE_PAYMENT_LINKS,
        |                       isTestMode = PayCraftConfig.IS_TEST_MODE,
        |                   ))
        |                   plans(...)
        |                   benefits(...)
        |                   supportEmail("...")
        |               }
        |           }
        |
        +-- 4e. Configure webhook URL in provider
        |       Shows: "Add this webhook URL in your Stripe Dashboard:"
        |       https://{supabase}.co/functions/v1/stripe-webhook/{tenant_id}
        |       Events: customer.subscription.created, updated, deleted
        |
        +-- 4f. Save to .paycraft/memory.json
        |       {
        |           "mode": "cloud",
        |           "cloud_api_key": "pk_test_abc123...",
        |           "tenant_id": "abc-123",
        |           "provider": "stripe",
        |           "webhook_url": "https://...",
        |           "phases_completed": ["env", "provider", "client"],
        |           "env_path": null  // no .env needed for cloud mode
        |       }
        |
        +-- 4g. Run verification
                curl GET /api/health { key: "pk_test_..." }
                -> Confirms: API key valid, provider configured, webhook URL active
                -> Shows: "Setup complete! Test with Stripe test card 4242..."
        |
        v
    Step 5: Sandbox Test (automatic)
    ┌─────────────────────────────────────────┐
    │ Run E2E test now? [Y/n]                 │
    │                                         │
    │ If Y:                                   │
    │   1. Opens Stripe test payment link     │
    │   2. Waits for webhook                  │
    │   3. Checks is_premium via SDK          │
    │   4. Reports: PASS / FAIL              │
    └─────────────────────────────────────────┘
```

### Self-Hosted Flow (Existing — Unchanged)

If developer picks [S] Self-Hosted, the existing 5-phase flow runs:
1. **Phase 1 (env)**: Ask Supabase URL, anon key, service role key -> write .env
2. **Phase 2 (supabase)**: Run migrations, deploy webhook Edge Functions
3. **Phase 3 (stripe/razorpay)**: Ask provider keys, create products/prices
4. **Phase 4 (client)**: Generate PayCraftConfig.kt, wire Koin, add UI
5. **Phase 5 (verify)**: E2E sandbox test -> live test

### Cloud vs Self-Hosted Comparison

| Step | Self-Hosted (5 phases) | Cloud (1 command) |
|------|----------------------|-------------------|
| Supabase setup | You create project, provide keys | Already done (shared) |
| Migrations | /paycraft-adopt-supabase runs them | Already deployed |
| Webhook functions | Deploy Edge Functions yourself | Already deployed, URL provided |
| Provider keys | Store in .env locally | Uploaded encrypted to cloud |
| Webhook URL | You configure in Stripe dashboard | You configure (URL auto-provided) |
| App code | Generated by /paycraft-adopt-client | Generated by /paycraft-adopt |
| Verification | /paycraft-adopt-verify | Built-in health check |
| **Total questions** | ~15 prompts across 5 phases | **4 prompts: API key, provider, test key, payment links** |
| **Time** | ~30 minutes | **~5 minutes** |

### Updated `/paycraft-adopt` Matrix (Phase 0)

```
┌──────────────────────────────────────────────────────┐
│  PayCraft Adoption — Setup Matrix                    │
│                                                      │
│  Mode: [C] Cloud  [S] Self-Hosted                    │
│                                                      │
│  If Cloud:                                           │
│    [1] Configure (API key + provider keys)    ⬜     │
│    [2] Verify (health check + sandbox test)   ⬜     │
│    [D] Done                                          │
│                                                      │
│  If Self-Hosted:                                     │
│    [1] Environment (.env bootstrap)           ⬜     │
│    [2] Supabase (migrations + webhooks)       ⬜     │
│    [3] Provider (Stripe/Razorpay setup)       ⬜     │
│    [4] Client (app integration)               ⬜     │
│    [5] Verify (E2E test)                      ⬜     │
│    [D] Done                                          │
│                                                      │
│  Choose:                                             │
└──────────────────────────────────────────────────────┘
```

### `.paycraft/memory.json` — Cloud Mode Schema

```json
{
    "mode": "cloud",
    "cloud_api_key": "pk_test_abc123...",
    "cloud_api_key_live": "pk_live_abc123...",
    "tenant_id": "abc-123-def-456",
    "tenant_name": "My Fitness App",
    "provider": "stripe",
    "webhook_url": "https://xxx.supabase.co/functions/v1/stripe-webhook/abc-123",
    "phases_completed": ["configure", "verify"],
    "phases_verified": ["sandbox"],
    "configure_file": "core/network/.../PayCraftConfig.kt",
    "koin_module_file": "core/network/.../di/NetworkModule.kt",
    "test_results": {
        "sandbox": { "status": "pass", "timestamp": "2026-04-30T07:00Z" }
    }
}
```

---

## Phase 0: Security Hardening (MUST complete before Phase 1)

Before going public or accepting tenants, the existing PayCraft library has 12 security gaps that must be fixed. Even if someone gains access to keys, the system should be designed so damage is minimal or impossible.

### Security Audit Findings

| # | Severity | Gap | Impact | Fix |
|---|----------|-----|--------|-----|
| S1 | **CRITICAL** | `.env` has real Stripe keys + Maven creds in git history | Attacker can charge cards, publish malicious packages | Rotate ALL keys immediately, add `.env` to `.gitignore`, use `git filter-repo` to purge history |
| S2 | **HIGH** | `is_premium(email)` callable by `anon` role — no ownership check | Email enumeration: attacker brute-forces email list to discover all paying users | Add rate limiting + require email ownership proof (OAuth/OTP or server token) |
| S3 | **HIGH** | `get_subscription(email)` returns full subscription data to `anon` | Attacker reads plan, provider, period dates, status for any email | Restrict to `authenticated` role or require server token |
| S4 | **HIGH** | `transfer_to_device(email, newToken)` callable by `anon` — no email ownership | Account takeover: attacker transfers victim's premium to their device | Require OTP verification or server token auth before transfer |
| S5 | **HIGH** | `check_premium_with_device(email, device_token)` no ownership gate | Token forgery: attacker probes tokens to hijack premium | Validate device_token belongs to caller's session |
| S6 | **MEDIUM** | Subscriptions table: `SELECT * USING (true)` — public read | GDPR violation: any Supabase call reads all subscriber records | Restrict to `service_role` + SECURITY DEFINER RPCs only |
| S7 | **MEDIUM** | `registered_devices` has no `anon` RLS deny policy | Direct Postgrest call leaks all device_tokens for all users | Add explicit DENY for `anon` + `authenticated` direct access |
| S8 | **MEDIUM** | Webhook verifies test secret first, falls back to live | Compromised test secret enables forgery against live data | Verify based on `event.livemode` flag, not key fallback order |
| S9 | **MEDIUM** | `device_id` is client-provided, stored unvalidated | Device binding is cosmetic — attacker can spoof any device_id | Add server-side fingerprint validation or signed device attestation |
| S10 | **LOW** | `PayCraftSettingsStore` uses plaintext multiplatform-settings | Rooted device can read cached email + premium status | Encrypt with platform keystore (Android Keystore, iOS Keychain) |
| S11 | **LOW** | `PayCraftLogger` emits user emails to logcat in debug | Email leak in debug builds shipped to testers | Redact emails in log output: `a***@gmail.com` |
| S12 | **LOW** | No replay protection on RPC calls | Intercepted calls can be replayed (idempotent but confirms capture) | Add nonce/timestamp to critical RPCs |

### Security Fix Tasks

#### T0.1: Secret Rotation (Day 1 — URGENT)
- Rotate ALL Stripe test + live keys in Stripe Dashboard
- Rotate Supabase service_role key
- Rotate Maven Central credentials + GPG key
- Run `git filter-repo` to purge `.env` from git history
- Add `.env` pattern to `.gitignore` (verify it's there)
- Add `SECURITY.md` with responsible disclosure process
- **Verification**: `git log -p --all -S 'sk_test_'` returns zero results

#### T0.2: RPC Access Control (Server Token Architecture)
The core defense: **even if someone has the Supabase anon key, they cannot abuse RPCs**.

Current (BROKEN):
```
anon user -> is_premium("anyone@email.com") -> returns true/false
```

Fixed (Server Token Required):
```
App starts -> PayCraft SDK -> register_device(email, device_id)
    -> Returns: server_token (UUID, stored in registered_devices)
    -> SDK caches server_token locally

All subsequent RPCs require server_token:
    is_premium(p_server_token) -> validates token -> returns status
    get_subscription(p_server_token) -> validates token -> returns data
    transfer_to_device(p_server_token, p_new_device_id) -> validates + OTP gate

Attacker with anon key but no server_token -> BLOCKED on every RPC
```

Migration `010_secure_rpcs.sql`:
```sql
-- All RPCs now require server_token instead of email
CREATE OR REPLACE FUNCTION is_premium(p_server_token TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_email TEXT;
    v_device_id TEXT;
BEGIN
    -- Validate server_token exists and is active
    SELECT email, device_id INTO v_email, v_device_id
    FROM registered_devices
    WHERE server_token = p_server_token
      AND is_active = true;

    IF v_email IS NULL THEN
        RETURN false;  -- Invalid token = not premium
    END IF;

    -- Check subscription for this email
    RETURN EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = v_email
          AND status = 'active'
          AND current_period_end > NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Why this makes stolen keys useless:**
- Anon key alone -> can call RPCs but needs a valid `server_token`
- `server_token` is generated server-side, tied to a specific device_id
- Attacker would need BOTH the anon key AND a valid server_token from a real device
- Even with both: server_token only returns data for its own email (no enumeration)

#### T0.3: RLS Lockdown
```sql
-- Drop public read on subscriptions
DROP POLICY "Public read subscriptions" ON subscriptions;

-- Only service_role and SECURITY DEFINER RPCs can access
CREATE POLICY "service_role_only" ON subscriptions
    FOR ALL USING (current_setting('role') = 'service_role');

-- registered_devices: deny all direct access
DROP POLICY IF EXISTS "service_role_all" ON registered_devices;
CREATE POLICY "service_role_only" ON registered_devices
    FOR ALL USING (current_setting('role') = 'service_role');
-- All access goes through SECURITY DEFINER RPCs (which run as service_role)
```

#### T0.4: Webhook Signature Hardening
```typescript
// server/functions/stripe-webhook/index.ts — FIXED
const event = JSON.parse(body);
const isLive = event.livemode === true;

// Use the CORRECT key based on event's own livemode flag
const secret = isLive
    ? Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')
    : Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');

// Verify signature with the correct key — no fallback
const verified = await stripe.webhooks.constructEventAsync(body, signature, secret);
// If verification fails -> 401 (not try-other-key)
```

#### T0.5: Local Storage Encryption
- Android: Use `EncryptedSharedPreferences` (AndroidX Security)
- iOS: Use Keychain Services
- Desktop/Web/WasmJs: Use platform-appropriate encrypted storage
- **What's encrypted**: email, isPremium, plan, expiresAt, server_token
- **Files**: `PayCraftSettingsStore.kt` + platform expect/actual

#### T0.6: Email Redaction in Logs
```kotlin
// PayCraftLogger.kt
private fun redactEmail(email: String): String {
    val parts = email.split("@")
    if (parts.size != 2) return "***"
    return "${parts[0].take(1)}***@${parts[1]}"
}
// "rajanmaurya@gmail.com" -> "r***@gmail.com"
```

### Security Architecture After Fixes

```
WHAT AN ATTACKER GETS WITH EACH KEY:

Supabase Anon Key (public, embedded in app):
    -> Can call RPCs: YES
    -> But needs server_token: YES (no token = blocked)
    -> Can read subscriptions directly: NO (RLS blocks)
    -> Can read registered_devices directly: NO (RLS blocks)
    -> Can enumerate emails: NO (RPCs need server_token, not email)
    VERDICT: USELESS without a valid server_token from a real device

Server Token (per-device, stored encrypted on device):
    -> Can check premium for OWN email only: YES
    -> Can check premium for OTHER emails: NO (token tied to one email)
    -> Can transfer to new device: NO (requires OTP gate)
    -> Can read other users' data: NO
    VERDICT: Scoped to single user — no lateral movement

Supabase Service Role Key (server-side only, never in app):
    -> Full DB access: YES
    -> Stored in: Edge Function secrets + .env (gitignored)
    -> Who has it: Only server/webhook functions
    VERDICT: Must be rotated if compromised, but never leaves server

Stripe Secret Key (server-side only, never in app):
    -> Can charge customers: YES
    -> Stored in: tenant_providers (AES-256 encrypted in DB)
    -> Decrypted only in: Edge Functions at webhook time
    -> Dashboard shows: Last 4 chars only (sk_...xxxx)
    VERDICT: Double-encrypted (pgcrypto + Supabase encryption at rest)

PayCraft Cloud API Key (pk_test_*/pk_live_*):
    -> Identifies tenant: YES
    -> Can read other tenants' data: NO (RLS + session variable)
    -> Can modify data without server_token: NO
    -> Can forge webhooks: NO (needs webhook signing secret)
    VERDICT: Identifies tenant but cannot act without device registration
```

---

## Platform Security: How Customer Keys Are Protected

This section documents how PayCraft Cloud protects tenant data and provider keys. This is the security story we tell customers.

### Defense-in-Depth Layers

```
Layer 1: TRANSPORT — All traffic over HTTPS/TLS 1.3
    |
Layer 2: AUTHENTICATION — Supabase Auth (JWT) for dashboard, API key for SDK
    |
Layer 3: TENANT ISOLATION — RLS policies scope ALL queries to tenant_id
    |
Layer 4: ENCRYPTION AT REST — Provider keys AES-256 via pgcrypto
    |
Layer 5: ACCESS CONTROL — RPCs require server_token, not just anon key
    |
Layer 6: WEBHOOK INTEGRITY — Stripe signature verification per-tenant secret
    |
Layer 7: LOCAL DEVICE — Platform keystore encryption for cached data
```

### Tenant Isolation Guarantee

```sql
-- EVERY query in PayCraft Cloud is scoped by tenant_id
-- Set at connection time from API key resolution

-- Pre-request function (runs before every RPC):
CREATE OR REPLACE FUNCTION resolve_tenant()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config(
        'app.tenant_id',
        (SELECT id::text FROM tenants
         WHERE api_key = current_setting('request.headers')::json->>'x-paycraft-api-key'),
        true  -- local to transaction
    );
END;
$$ LANGUAGE plpgsql;

-- RLS on subscriptions:
CREATE POLICY "tenant_isolation" ON subscriptions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- RESULT: Tenant A can NEVER see Tenant B's data
-- Even if Tenant A somehow gets Tenant B's anon key,
-- the API key header determines which tenant_id is set
```

### Provider Key Security

| Protection | How |
|-----------|-----|
| **Encryption at rest** | AES-256-GCM via `pgcrypto` (`pgp_sym_encrypt`) |
| **Encryption key isolation** | Stored in Supabase Edge Function secrets (NOT in DB) |
| **Key rotation** | Dashboard: "Rotate Keys" -> re-encrypts with new encryption key |
| **Access control** | Only Edge Functions (webhook handlers) decrypt keys — never exposed to SDK, dashboard shows masked (last 4 chars) |
| **Audit trail** | `tenant_provider_audit_log` records who accessed/rotated keys + timestamp |
| **No raw export** | Dashboard cannot export/copy full keys — only re-enter new ones |
| **Supabase encryption** | Supabase Pro encrypts DB at rest (AES-256) — double encryption |

### What Happens If...

| Scenario | Impact | Why |
|----------|--------|-----|
| **Attacker gets Supabase anon key** | Nothing | RPCs need server_token; RLS blocks direct table reads |
| **Attacker gets tenant's API key (pk_live_*)** | Nothing | Identifies tenant but RPCs still need server_token from real device |
| **Attacker gets server_token** | Can check premium for ONE user | Token scoped to single email; transfers need OTP; no lateral movement |
| **Attacker gets webhook signing secret** | Can forge webhooks for ONE tenant | Limited to one tenant; other tenants unaffected; audit log detects anomalies |
| **Attacker gets Stripe secret key** | Can charge that tenant's customers | Key encrypted in DB; only decrypted in Edge Function; rotation available; Stripe has its own fraud detection |
| **Attacker gets PAYCRAFT_ENCRYPTION_KEY** | Can decrypt ALL tenant provider keys | This is the crown jewel — stored ONLY in Supabase secrets (not DB, not git); requires Supabase dashboard access to read |
| **Attacker gets Supabase service_role key** | Full DB access for that Supabase project | Critical — but: never in app binary, never in git, stored only in Edge Function secrets + operator .env |
| **Supabase data breach** | Encrypted provider keys exposed as BYTEA blobs | Attacker still needs PAYCRAFT_ENCRYPTION_KEY to decrypt; DB encryption at rest adds another layer |
| **Attacker compromises Edge Function** | Can read decrypted keys during runtime | Supabase Edge Functions run in Deno isolates; no persistent state; requires Supabase deployment access |

### Audit & Monitoring

Migration `023_security_audit_log.sql`:
```sql
CREATE TABLE security_audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id),
    event_type TEXT NOT NULL,       -- 'key_rotation', 'key_access', 'webhook_failure', 'rpc_blocked', 'login', 'transfer_attempt'
    actor TEXT,                      -- 'edge_function', 'dashboard_user:uuid', 'sdk:device_id'
    details JSONB DEFAULT '{}',     -- event-specific payload (redacted)
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast per-tenant queries
CREATE INDEX idx_audit_tenant_time ON security_audit_log(tenant_id, created_at DESC);

-- Auto-purge after 90 days (Supabase cron — free)
-- pg_cron: DELETE FROM security_audit_log WHERE created_at < NOW() - INTERVAL '90 days';
```

### Dashboard Security Tab (Per Tenant)

```
┌─────────────────────────────────────────────┐
│  Security — My Fitness App                  │
│                                             │
│  API Keys                                   │
│    Test: pk_test_...a1b2  [Rotate]         │
│    Live: pk_live_...c3d4  [Rotate]         │
│                                             │
│  Provider Keys                              │
│    Stripe Test: sk_test_...7X2b [Update]   │
│    Stripe Live: sk_live_...9Y4z [Update]   │
│    (Keys are AES-256 encrypted at rest)    │
│                                             │
│  Webhook Secrets                            │
│    Test: whsec_...Ie1  [Rotate]            │
│    Live: whsec_...Jf2  [Rotate]            │
│                                             │
│  Recent Security Events          [View All] │
│    2026-04-30 12:00 — API key rotated      │
│    2026-04-29 08:15 — Webhook failure (3x) │
│    2026-04-28 16:30 — New device registered │
│                                             │
│  Security Score: 92/100                     │
│    [x] .env secrets not in git             │
│    [x] Webhook signature verified          │
│    [x] RLS policies active                 │
│    [ ] Enable 2FA on dashboard (recommended)│
└─────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (Open Source + Docs)

Goal: Make PayCraft a credible public open-source project. No library code changes.

**Infra**: GitHub Pages (free) + GitHub Actions (free)

### T1.1: Repository Cleanup
- Fix `CONTRIBUTING.md` (still has `TEMPLATE_LIBRARY_NAME` placeholders)
- Remove `TEMPLATE.md`, clean up `customizer.sh`/`sync-dirs.sh`
- Add `SECURITY.md` (vulnerability disclosure), GitHub issue/PR templates
- Audit `.gitignore` for secrets
- **Files**: `CONTRIBUTING.md`, `.gitignore`, `README.md`

### T1.2: Documentation Site
- Set up Docusaurus deployed to **GitHub Pages** ($0)
- Migrate existing `docs/` (ARCHITECTURE, QUICK_START, PROVIDERS, SECURITY, CUSTOMIZATION, FAQ)
- Add per-platform quick-start guides: Android (Compose+Koin), iOS (SwiftUI), Desktop (JVM), Web (WasmJs)
- Add "Concepts" section: provider-agnostic model, device binding, smart sync, webhook flow
- Add API reference from KDoc
- GitHub Actions workflow for auto-deploy on merge to main
- **Source**: `PayCraft/docs/*.md`

### T1.3: Integration Examples
- Create `paycraft-sample/` with minimal per-platform projects
  - `paycraft-sample/android-compose/` — bare Android app with PayCraft
  - `paycraft-sample/ios-swiftui/` — SwiftUI wrapper
  - `paycraft-sample/desktop-jvm/` — Desktop Compose
  - `paycraft-sample/web-wasm/` — Browser WasmJs
- Each: configure -> paywall -> premium gating -> restore
- **Reference**: `PayCraft/sample-app/.../BillingStateDebugPanel.kt`

### T1.4: CI/CD for Public Repo
- Verify existing `gradle.yml` workflow (GitHub Actions free tier)
- Add binary compatibility validator
- Add docs site deployment workflow (GitHub Pages)
- Add tag-triggered Maven Central publish (partially exists in `scripts/release.sh`)

---

## Phase 2: Multi-Tenant Architecture

Goal: Transform single-org model into multi-tenant so multiple customers share one Supabase deployment. This is the foundation for the hosted service.

**Infra**: Existing Supabase free project (reuse PayCraft's current Supabase instance)

### T2.1: Tenant Registry + Schema Migration
- Migration `012_tenants.sql`: `tenants(id, name, api_key, api_secret, webhook_secret, status, plan, created_at)`
- Migration `013_add_tenant_id.sql`: Add `tenant_id UUID REFERENCES tenants(id)` to `subscriptions` + `registered_devices`
- Change unique constraint: `(email)` -> `(tenant_id, email)`
- **Breaking change** -> version bump to **2.0.0**
- Self-hosted users: `tenant_id DEFAULT NULL` preserves backward compat
- **Files**: `server/migrations/012-013_*.sql`

### T2.2: Tenant-Aware RPCs (Header-Based)
- SDK sends `X-PayCraft-API-Key` header on Supabase client
- Pre-request function resolves API key -> `tenant_id` -> sets session variable
- All 8 RPCs read tenant from session (no signature changes for self-hosted)
- RPCs affected: `is_premium`, `get_subscription`, `register_device`, `check_premium_with_device`, `transfer_to_device`, `revoke_device`, `get_active_devices`, `check_otp_gate`
- **Files**: `server/migrations/015_tenant_aware_rpcs.sql`
- **SDK**: `PayCraft.kt` (add optional `apiKey`), `PayCraftModule.kt` (inject header)

### T2.3: Tenant-Aware Webhooks
- Per-tenant webhook URLs: `https://{project}.supabase.co/functions/v1/stripe-webhook/{tenant_id}`
- Edge Function extracts tenant from URL path, passes to handler (free — 500K invocations/month)
- **Files**: `server/functions/stripe-webhook/index.ts`, `server/functions/_shared/subscription-handler.ts`

### T2.4: RLS Policies
- Replace "Public read" with tenant-scoped read on `subscriptions`
- Add tenant RLS to `registered_devices`
- `tenants` table: service_role only
- **File**: `server/migrations/016_tenant_rls.sql`

### T2.5: SDK Backward Compatibility
- `apiKey` optional in `PayCraftConfigBuilder`
- No header if omitted -> RPCs use NULL tenant_id -> legacy single-tenant
- **Files**: `PayCraft.kt`, `PayCraftModule.kt`

### T2.6: Keep-Alive Workflow
- Add `.github/workflows/keep-alive.yml` — weekly cron ping to prevent Supabase free tier pausing
- Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY` in GitHub repo secrets

---

## Phase 3: Web Dashboard

Goal: Hosted web UI for tenant admins — subscriber management, revenue analytics, webhook monitoring.

**Infra**: Vercel Hobby (free) + Supabase Auth (free — 50K MAU)

### T3.1: Dashboard Setup
- `dashboard/` — Next.js 14+ (App Router) + Tailwind + shadcn/ui
- Deploy to **Vercel Hobby** (free tier — 1 project, 100GB bandwidth)
- Supabase Auth for dashboard users (free — 50K MAU, included in existing project)
- Migration `017_dashboard_auth.sql`: `tenant_admins(tenant_id, user_id, role)`
- Auth pages: sign-up, sign-in, forgot password

### T3.2: Subscriber Management
- List subscriptions per tenant (search, filter, sort)
- Subscriber detail: history, devices, status
- Manual actions: extend, cancel
- CSV export

### T3.3: Revenue Analytics
- MRR calculation (needs server-side pricing)
- Migration `019_plan_pricing.sql`: `tenant_plan_prices(tenant_id, plan_id, amount_cents, currency, interval)`
- Churn rate, new subscribers cohorts, revenue by plan/provider, LTV
- Migration `018_analytics_views.sql`: materialized views (runs on Supabase free — no extra cost)

### T3.4: Webhook Monitoring
- Migration `020_webhook_logs.sql`: log all incoming webhooks
- Dashboard: delivery status, payload (redacted), manual retry
- Modify `subscription-handler.ts` + `stripe-webhook/index.ts` to log events

### T3.5: Provider Configuration UI
- Configure Stripe/Razorpay keys per tenant
- Show tenant-specific webhook URLs
- Test webhook connectivity
- Migration `021_tenant_provider_config.sql`: `tenant_providers(tenant_id, provider, config_encrypted, webhook_secret)`

---

## Phase 4: Hosted Service

Goal: Self-service tenant provisioning + usage-based billing. Still on free tier until revenue triggers upgrade.

**Infra**: Same Supabase + Vercel — no new services needed

### T4.1: Tenant Self-Service API
- Tenant sign-up flow on dashboard (Supabase Auth — free)
- Auto-generate API key + webhook secret on tenant creation
- API key rotation endpoint
- Usage metering via Supabase RPC (count subscribers per tenant)

### T4.2: Hosted Webhook Endpoints
- Managed webhook URLs — tenants point Stripe/Razorpay to PayCraft Cloud URLs
- No Edge Function deployment required by tenants
- Tenant routing via URL path parameter (already built in T2.3)

### T4.3: Billing (PayCraft Billing Itself via Stripe)
- Free tier: auto-provisioned, 100 subscriber limit enforced in RPCs
- Pro/Enterprise: Stripe Checkout Session from dashboard
- Stripe webhook -> update `tenants.plan` column
- No monthly Stripe fee — only 2.9% + $0.30 per transaction when tenants pay us

### T4.4: Tenant Alerts
- **Resend** free tier (3,000 emails/month) for:
  - Welcome email on sign-up
  - Approaching subscriber limit warnings
  - Webhook delivery failures
  - Subscription expiry notifications

---

## Phase 5: Growth

Goal: Expand provider ecosystem and developer tooling.

**Infra**: No additional cost

### T5.1: Additional Providers
- Paddle, PayPal, LemonSqueezy, Flutterwave, Paystack, Midtrans, BTCPay
- Each provider: implement `PaymentProvider` interface + webhook Edge Function
- All run on existing Supabase Edge Functions (free — 500K invocations shared)

### T5.2: CLI Tool
- `npx paycraft init` — scaffolds Supabase migrations + webhook functions
- Published to npm (free)
- For self-hosted users who don't use PayCraft Cloud

### T5.3: Plugin System
- Community-contributed providers as separate Maven Central artifacts
- Plugin registry in docs site (GitHub Pages — free)

---

## Dependency Graph

```
Phase 0 (Security) <- MUST complete first, blocks everything
    |
Phase 1 (Foundation) <- after P0, no other deps, $0
    |
Phase 2 (Multi-Tenant) <- T2.1 first, reuse existing Supabase, $0
    |
Phase 3 (Dashboard) <- T3.1 can parallel Phase 2, Vercel free, $0
    |
Phase 4 (Hosted) <- needs Phase 2 + 3, Stripe pay-per-use only
Phase 5 (Growth) <- independent, can parallel Phase 3-4, $0
```

---

## Cost Summary

### Monthly Infrastructure Cost by Phase

| Phase | Services | Cost/month |
|-------|----------|-----------|
| **P1: Foundation** | GitHub Pages + GitHub Actions | **$0** |
| **P2: Multi-Tenant** | Supabase Free + GitHub Actions cron | **$0** |
| **P3: Dashboard** | Vercel Hobby + Supabase Auth Free | **$0** |
| **P4: Hosted Service** | Stripe (pay-per-transaction) + Resend Free | **$0** |
| **P5: Growth** | npm (free) + existing infra | **$0** |
| **TOTAL AT LAUNCH** | | **$0/month** |

### Upgrade Path (Revenue-Triggered)

| Revenue Milestone | Upgrade | New Monthly Cost |
|-------------------|---------|-----------------|
| $0 (pre-revenue) | All free tiers | $0 |
| First Pro tenant ($49/mo) | Supabase Pro (reliability) | $25 |
| 5+ tenants (~$245/mo) | + Vercel Pro (custom domain) | $45 |
| 20+ tenants (~$980/mo) | + Resend Starter (more emails) | $65 |
| 500+ tenants (~$20K/mo) | Supabase Team (scale) | $620 |

### Free Tier Risks + Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase pauses after 7 days inactivity | DB goes offline | GitHub Actions weekly cron ping ($0) |
| 500MB DB limit | Can't onboard more tenants | Upgrade to Pro at first revenue ($25/mo) |
| Vercel Hobby = 1 project | Can't host docs + dashboard separately | Docs on GitHub Pages, dashboard on Vercel |
| No Supabase backups on free tier | Data loss risk | Manual pg_dump via GitHub Actions cron ($0) |
| Supabase free = 2 projects max | Can't create staging | Use branching or local Supabase for dev |
| Edge Functions cold start on free | Slow first webhook | Acceptable — webhook processing isn't latency-critical |

### Backup Strategy (Free)

```yaml
# .github/workflows/backup.yml — weekly DB dump
name: Database Backup
on:
  schedule:
    - cron: '0 2 * * 0'  # Sunday 2AM UTC
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - run: |
          pg_dump "${{ secrets.SUPABASE_DB_URL }}" | gzip > backup.sql.gz
      - uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_id }}
          path: backup.sql.gz
          retention-days: 30
```

---

## Key Files

| File | Phase | Change |
|------|-------|--------|
| `PayCraft/cmp-paycraft/.../PayCraft.kt` | P2 | Add optional `apiKey` config |
| `PayCraft/cmp-paycraft/.../di/PayCraftModule.kt` | P2 | Inject `X-PayCraft-API-Key` header |
| `PayCraft/server/functions/_shared/subscription-handler.ts` | P2 | Tenant-aware upserts |
| `PayCraft/server/functions/stripe-webhook/index.ts` | P2 | Extract tenant from URL path |
| `PayCraft/server/migrations/` | P2-3 | Migrations 012-021 |
| `PayCraft/CONTRIBUTING.md` | P1 | Fix template placeholders |
| `PayCraft/docs/` | P1 | Source for Docusaurus site |
| `.github/workflows/keep-alive.yml` | P2 | Supabase free tier ping |
| `.github/workflows/backup.yml` | P2 | Weekly DB backup |
| `.github/workflows/docs-deploy.yml` | P1 | GitHub Pages deployment |
| `dashboard/` (new) | P3 | Next.js on Vercel Hobby |
| `PayCraft/server/migrations/012_rls_lockdown.sql` | P0 | Drop public read, service_role_only on both tables |
| `PayCraft/server/migrations/013_secure_rpcs.sql` | P0 | Server token architecture for all RPCs |
| `PayCraft/cmp-paycraft/.../network/PayCraftService.kt` | P0 | RPCs now take server_token instead of email |
| `PayCraft/cmp-paycraft/.../core/PayCraftBillingManager.kt` | P0 | Updated all RPC call sites for server_token |
| `PayCraft/cmp-paycraft/.../persistence/PayCraftSettingsStore.kt` | P0 | Constructor accepts encrypted Settings via DI |
| `PayCraft/cmp-paycraft/.../PayCraftPlatform.android.kt` | P0 | Added encryptedSettings() factory |
| `PayCraft/cmp-paycraft/.../debug/PayCraftLogger.kt` | P0 | Email redaction in logs |
| `PayCraft/SECURITY.md` | P0 | Responsible disclosure + security architecture |
| `PayCraft/server/migrations/022_email_config.sql` | P4 | Per-tenant email notification config |

---

## Verification

0. **Phase 0**: `git log -p --all -S 'sk_test_'` returns zero results; `is_premium()` without server_token returns error; direct Postgrest `SELECT * FROM subscriptions` as anon returns empty; webhook with wrong signature returns 401; `transfer_to_device()` without OTP returns blocked
1. **Phase 1**: Docs site live on GitHub Pages, all examples compile, CI passes on GitHub Actions free
2. **Phase 2**: Existing single-tenant tests pass (NULL tenant), multi-tenant isolation tests, keep-alive cron runs weekly, backup cron creates artifacts
3. **Phase 3**: Dashboard deployed on Vercel Hobby, login works via Supabase Auth free, subscriber list filtered by tenant, analytics queries return correct MRR
4. **Phase 4**: Tenant sign-up -> API key generated -> SDK connects -> webhook routes -> billing via Stripe Checkout, all on free tier
5. **E2E**: Two different apps configured with different API keys -> each sees only their own subscribers, $0 infra cost confirmed
6. **Security E2E**: Attacker with anon key cannot enumerate emails, cannot read subscriptions, cannot forge webhooks, cannot transfer devices — each attack vector returns access denied

---

## Manual Steps Required (User Action)

These steps cannot be automated and require manual action in external dashboards. Perform after all Phase 0 code changes are merged.

### Secret Rotation (T0.1 — URGENT)

| Step | Where | Action |
|------|-------|--------|
| 1 | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) | Rotate **test** secret key → update Supabase Edge Function secret `STRIPE_TEST_SECRET_KEY` |
| 2 | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) | Rotate **live** secret key → update Supabase Edge Function secret `STRIPE_LIVE_SECRET_KEY` |
| 3 | [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) | Rotate webhook signing secrets → update `STRIPE_TEST_WEBHOOK_SECRET` + `STRIPE_LIVE_WEBHOOK_SECRET` |
| 4 | [Supabase Dashboard → Settings → API](https://supabase.com/dashboard/project/_/settings/api) | Rotate `service_role` key → update Edge Function secrets |
| 5 | Maven Central / Sonatype | Rotate publishing credentials + GPG signing key |
| 6 | Local `.env` | Update all rotated values in your local `.env` file |

### Git History Purge

**WARNING**: This rewrites git history. All collaborators must re-clone after this.

```bash
# 1. Verify .env is in .gitignore (already confirmed ✓)
grep '\.env' .gitignore

# 2. Purge .env from entire git history
pip install git-filter-repo
git filter-repo --path .env --invert-paths

# 3. Force push (destructive — all collaborators must re-clone)
git push --force --all
git push --force --tags

# 4. Verify no secrets remain
git log -p --all -S 'sk_test_' | head -20   # Should return nothing
git log -p --all -S 'sk_live_' | head -20   # Should return nothing
git log -p --all -S 'service_role' | head -20  # Should return nothing
```

### iOS Keychain Migration (P1 Follow-up)

The iOS `DeviceTokenStore` currently uses `NSUserDefaults` (encrypted at rest via iOS Data Protection, but not Keychain-level secure). A follow-up task should:

1. Implement Keychain Services via Kotlin/Native cinterop
2. Build-test on a real iOS target (cinterop types need validation)
3. Add migration logic: read from NSUserDefaults → write to Keychain → delete from NSUserDefaults

---

## Implementation Status

All code is written. Every phase is complete. Deploy via `/paycraft-adopt --cloud` or manual steps below.

| Phase | Status | Key Artifacts |
|-------|--------|---------------|
| **P0: Security** | DONE | Migrations 012-013, SECURITY.md, server token RPCs, RLS lockdown |
| **P1: Foundation** | DONE | Docusaurus, 4 platform examples, 6 CI workflows |
| **P2: Multi-Tenant** | DONE | Migrations 014-017, SDK `apiKey`, tenant-aware RPCs + webhooks |
| **P3: Dashboard** | DONE | Full Next.js dashboard, migrations 018-022 |
| **P4: Hosted Service** | DONE | Migrations 023-025, provisioning, billing, alerts |
| **P5: Growth** | DONE | 7 new providers, CLI tool, plugin system |

### Phase 6: Deployment — see framework plan for full deployment steps (D1-D10)
