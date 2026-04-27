# /paycraft-adopt-keys — Phase 6: Real Keys Guide

> Loaded by `/paycraft-adopt` when user selects **[D] Get keys guide**.
> No automation — step-by-step instructions for obtaining every key from
> Supabase and Stripe dashboards (test and live).

---

```
╔══ Getting Real Keys — Complete Guide ═══════════════════════════════════════════╗
║  Complete ALL sections before switching IS_TEST_MODE = false in PayCraftConfig  ║
╚═════════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION A — SUPABASE KEYS  (same project for test AND live)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Supabase uses ONE project for both test and live Stripe. Keys do not change when going live.

A1. PAYCRAFT_SUPABASE_URL                     Status: [from matrix]
    1. https://supabase.com/dashboard → select project
    2. Settings (sidebar) → API
    3. Copy "Project URL"  (e.g. https://xxxxx.supabase.co)

A2. PAYCRAFT_SUPABASE_ANON_KEY                Status: [from matrix]
    1. Same page: Settings → API
    2. Under "Project API keys" → copy "anon" key
    3. Safe for client-side use (enforced by RLS)

A3. PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY        Status: [from matrix]
    1. Same page: Settings → API
    2. Copy "service_role" key  ⚠️ NEVER put in client code — server/Edge Functions only

A4. PAYCRAFT_SUPABASE_PROJECT_REF             Status: [from matrix]
    1. From the project URL: https://supabase.com/dashboard/project/[THIS_IS_THE_REF]
    2. Or: Settings → General → "Reference ID"
    (20-character alphanumeric string)

A5. PAYCRAFT_SUPABASE_ACCESS_TOKEN            Status: [from matrix]
    1. https://supabase.com/dashboard/account/tokens
    2. "Generate new token" → name it "PayCraft CLI"
    3. Copy the sbp_... token (shown ONCE — save it)
    Used for: supabase CLI commands (deploy functions, set secrets)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION B — STRIPE TEST KEYS  (sandbox, no real money)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prerequisite: Stripe account registered at https://dashboard.stripe.com/register

B1. PAYCRAFT_STRIPE_TEST_SECRET_KEY           Status: [from matrix]
    1. https://dashboard.stripe.com
    2. Toggle "Test mode" ON (top-right switch, looks like a slider)
    3. Developers (sidebar) → API keys
    4. "Secret key" row → click "Reveal test key"
    5. Copy sk_test_... value
    ⚠️ Never commit to git. Store in .env only.

B2. PAYCRAFT_STRIPE_WEBHOOK_SECRET            Status: [from matrix]
    1. Stripe Dashboard (Test mode) → Developers → Webhooks
    2. Find your endpoint (URL: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook)
       If no endpoint: Phase 2 + Phase 3 create it automatically
    3. Click the endpoint → "Signing secret" → click "Reveal"
    4. Copy whsec_... value
    Note: This secret matches what's set in Supabase function secrets as STRIPE_WEBHOOK_SECRET

B3. PAYCRAFT_STRIPE_LINK_* (test payment links)   Status: [from matrix]
    Created AUTOMATICALLY by Phase 3 (run /paycraft-adopt → [A] Full setup → Phase 3 test mode).
    To create manually:
    1. Stripe Dashboard (Test mode) → Payment Links → "New"
    2. Select product + price (created by Phase 3)
    3. Advanced → Metadata → Add: key=plan_id, value=monthly (or quarterly/semiannual/yearly)
    4. Confirmation page → Redirect → enter: [PAYCRAFT_APP_REDIRECT_URL]
    5. Create → copy https://buy.stripe.com/test_... URL

B4. PAYCRAFT_STRIPE_PORTAL_URL (test)             Status: [from matrix]
    1. Stripe Dashboard (Test mode) → Billing → Customer portal (sidebar)
    2. Configure: enable "Cancel subscription", "Update payment method", "View invoices"
    3. Click "Save changes"
    4. The portal URL appears below: https://billing.stripe.com/p/login/test_...
       OR click "Copy link" button

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION C — STRIPE LIVE KEYS  (real money — do this last)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prerequisite: Stripe account MUST be activated with identity verification.
  1. https://dashboard.stripe.com/account/onboarding
  2. Complete business details, bank account, identity verification
  3. Wait for approval (usually instant for individuals)

C1. PAYCRAFT_STRIPE_LIVE_SECRET_KEY               Status: [from matrix]
    1. Stripe Dashboard → Toggle "Live mode" ON (test mode switch turns OFF)
    2. Developers → API keys
    3. "Secret key" → "Reveal live key"
    4. Copy sk_live_... value
    ⚠️ This key charges real money. Never commit. Rotate immediately if leaked.

C2. PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET           Status: [from matrix]
    Phase 3 (live mode) creates the live webhook endpoint automatically.
    To get the secret after Phase 3 runs with PAYCRAFT_MODE=live:
    1. Stripe Dashboard (LIVE mode) → Developers → Webhooks
    2. Find: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook
    3. Click endpoint → "Signing secret" → "Reveal" → copy whsec_...
    ⚠️ Different from test webhook secret — each endpoint has its own secret.
    After getting it:
      supabase secrets set STRIPE_WEBHOOK_SECRET=[live_secret]
                           STRIPE_SECRET_KEY=[sk_live_...]
                           --project-ref [ref]

C3. PAYCRAFT_STRIPE_LIVE_LINK_* (live payment links)
    Created automatically by Phase 3 with PAYCRAFT_MODE=live.
    Run: /paycraft-adopt → [F] Fix specific phase → Phase 3
    Each link will be https://buy.stripe.com/... (no /test/ prefix in live mode).

C4. PAYCRAFT_STRIPE_LIVE_PORTAL_URL               Status: [from matrix]
    1. Stripe Dashboard (LIVE mode) → Billing → Customer portal
    2. Same configuration as test portal
    3. Copy live portal URL: https://billing.stripe.com/p/login/...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION D — APP DEEP LINK (redirect after payment)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

D1. PAYCRAFT_APP_REDIRECT_URL                     Status: [from matrix]
    Format: [your-app-scheme]://paycraft/premium/success
    Example: reelsdownloader://paycraft/premium/success

    To define your scheme:
    1. Choose a unique scheme (e.g. your app package name reversed: com.yourapp → yourapp)
    2. Set in .env: PAYCRAFT_APP_REDIRECT_URL=yourapp://paycraft/premium/success
    3. Phase 4 (Step 4.7B) registers it in AndroidManifest.xml automatically:
       <data android:scheme="yourapp" android:host="paycraft" android:pathPrefix="/premium" />
    4. For iOS: Phase 4 adds CFBundleURLTypes to Info.plist
    Note: The same URL is used for both test and live payment links.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION E — GOING LIVE CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Complete ALL of these before flipping IS_TEST_MODE = false:

[ ] Phase 5B PASSED  (sandbox test card → webhook → is_premium = true)
[ ] Stripe account ACTIVATED  (identity verified, bank connected)
[ ] PAYCRAFT_STRIPE_LIVE_SECRET_KEY set (sk_live_...)
[ ] Phase 3 (live) completed — live products + payment links + live webhook endpoint
[ ] PAYCRAFT_STRIPE_LIVE_LINK_* all set in .env
[ ] PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET set in .env
[ ] Supabase secrets updated for live:
      supabase secrets set STRIPE_SECRET_KEY=[sk_live_...]
                           STRIPE_WEBHOOK_SECRET=[live_whsec_...]
                           --project-ref [ref]
[ ] PayCraftConfig.kt LIVE_PAYMENT_LINKS filled
[ ] IS_TEST_MODE = false in PayCraftConfig.kt
[ ] App rebuilt with IS_TEST_MODE = false
[ ] Phase 5C (live test) PASSED

⚠️  KEY SEPARATION REMINDER:
  - Stripe test mode and live mode have SEPARATE webhook endpoints and signing secrets
  - Register the webhook URL at:
    Test:  https://dashboard.stripe.com/test/webhooks
    Live:  https://dashboard.stripe.com/webhooks
  - The Supabase function URL is the SAME for both — only the secrets differ
  - Always update STRIPE_WEBHOOK_SECRET in Supabase secrets when switching modes
```

---

After displaying, show:
```
"[A] Run test setup now (Phase 1–3)"
"[B] Run live setup now (Phase 3 with PAYCRAFT_MODE=live — requires live keys above)"
"[C] Re-run status matrix"
"[Q] Done"
```
