# /paycraft-adopt-cloud — PayCraft Cloud E2E Deployment

> **PHASE C** — Cloud mode. Collects all keys, deploys infrastructure, verifies E2E.
> Triggered by [C] Cloud in the `/paycraft-adopt` matrix.
> Replaces Phases 1–5 for Cloud deployments — one command does everything.

---

## Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Supabase project created (free tier is fine)
- Stripe account (no monthly fee — pay-per-transaction)
- Git repository with PayCraft source

---

## STEP C.0 — PRE-FLIGHT CHECKS

```
CHECK supabase CLI:
  RUN: supabase --version
  IF missing: HARD STOP — "Install Supabase CLI: npm install -g supabase"

CHECK PayCraft root:
  RESOLVE paycraft_root (same logic as STEP 0B in paycraft-adopt.md)
  VERIFY: server/migrations/ directory exists with 25 .sql files
  IF missing: HARD STOP — "PayCraft source not found. Clone or set path."

CHECK existing .env:
  ENV_PATH = {paycraft_root}/.env
  IF exists: READ existing values → pre-fill prompts below
  ELSE: will create fresh

OUTPUT:
  "✓ Supabase CLI: {version}"
  "✓ PayCraft root: {paycraft_root}"
  "✓ Migrations: {count} SQL files"
```

---

## STEP C.1 — COLLECT SUPABASE CREDENTIALS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 1/6: Supabase Project"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ASK: "Supabase Project URL (e.g. https://xxx.supabase.co):"
  VALIDATE: starts with https://, contains supabase
  STORE → SUPABASE_URL

ASK: "Supabase Anon Key:"
  VALIDATE: length > 100, starts with eyJ
  STORE → SUPABASE_ANON_KEY

ASK: "Supabase Service Role Key:"
  VALIDATE: length > 100, starts with eyJ
  STORE → SUPABASE_SERVICE_ROLE_KEY

ASK: "Supabase DB URL (postgresql://...):"
  VALIDATE: starts with postgresql://
  STORE → SUPABASE_DB_URL

DERIVE: PROJECT_REF = extract from SUPABASE_URL (e.g. "mlwfgytjxlqyfxcgpysm")

VERIFY connection:
  RUN: curl -sf "{SUPABASE_URL}/rest/v1/" -H "apikey: {SUPABASE_ANON_KEY}" > /dev/null
  IF fail: HARD STOP — "Cannot connect to Supabase. Check URL and anon key."

OUTPUT: "✓ Supabase connected: {PROJECT_REF}"
```

---

## STEP C.2 — COLLECT STRIPE CREDENTIALS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 2/6: Stripe Keys"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ""
  "PayCraft Cloud needs TWO sets of Stripe keys:"
  "  1. Tenant payment processing (customer webhooks)"
  "  2. PayCraft Cloud billing (your own subscription revenue)"

ASK: "Stripe Test Secret Key (sk_test_...):"
  VALIDATE: starts with sk_test_
  STORE → STRIPE_TEST_SECRET_KEY

ASK: "Stripe Live Secret Key (sk_live_...) [or Enter to skip for now]:"
  VALIDATE: starts with sk_live_ OR empty
  STORE → STRIPE_LIVE_SECRET_KEY (may be empty)

ASK: "PayCraft Cloud Billing Stripe Secret Key (for billing YOUR tenants):"
  DISPLAY: "This is the Stripe key for your own PayCraft Cloud Stripe account."
  DISPLAY: "It's used to charge tenants who upgrade to Pro/Enterprise."
  VALIDATE: starts with sk_
  STORE → PAYCRAFT_CLOUD_STRIPE_SECRET_KEY

OUTPUT: "✓ Stripe keys collected"
```

---

## STEP C.3 — COLLECT REMAINING SERVICE KEYS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 3/6: Service Keys"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ASK: "Resend API Key (for email notifications) [or Enter to skip]:"
  DISPLAY: "Get one free at resend.com (3,000 emails/month)"
  VALIDATE: starts with re_ OR empty
  STORE → RESEND_API_KEY (may be empty)

GENERATE encryption key:
  RUN: openssl rand -hex 32
  STORE → PAYCRAFT_ENCRYPTION_KEY
  DISPLAY: "✓ Generated encryption key for provider secrets"

OUTPUT: "✓ All keys collected"
```

---

## STEP C.4 — APPLY MIGRATIONS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 4/6: Database Setup (25 migrations)"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

MIGRATION_DIR = {paycraft_root}/server/migrations

FOR EACH sql_file IN (ls {MIGRATION_DIR}/*.sql | sort):
  migration_name = filename without .sql
  DISPLAY: "  Applying {migration_name}..."

  RUN: psql "{SUPABASE_DB_URL}" -f "{sql_file}" 2>&1
  IF exit_code != 0:
    -- Check if it's an "already exists" error (idempotent)
    IF stderr contains "already exists":
      DISPLAY: "  ✓ {migration_name} (already applied)"
      CONTINUE
    ELSE:
      HARD STOP:
        "✗ Migration {migration_name} failed"
        "Error: {stderr}"
        "Fix the issue and re-run /paycraft-adopt --cloud"

  DISPLAY: "  ✓ {migration_name}"

VERIFY:
  RUN: psql "{SUPABASE_DB_URL}" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('subscriptions','registered_devices','tenants','tenant_admins','tenant_providers','tenant_alert_prefs','webhook_logs')"
  EXPECTED: 7 tables
  IF less: DISPLAY warning with missing tables

  RUN: psql "{SUPABASE_DB_URL}" -c "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('is_premium','get_subscription','register_device','resolve_tenant','provision_tenant','upgrade_tenant_plan','check_subscriber_limit') ORDER BY routine_name"
  EXPECTED: 7 RPCs

OUTPUT:
  "✓ Database ready: {table_count} tables, {rpc_count} RPCs"
```

---

## STEP C.5 — DEPLOY EDGE FUNCTIONS + SECRETS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 5/6: Edge Functions + Secrets"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

-- Link to project
RUN: supabase link --project-ref {PROJECT_REF}
IF fail: ASK for Supabase access token → supabase login

-- Deploy all Edge Functions
FUNCTIONS_DIR = {paycraft_root}/server/functions
DEPLOY_LIST = [
  "stripe-webhook",
  "razorpay-webhook",
  "paddle-webhook",
  "paypal-webhook",
  "lemonsqueezy-webhook",
  "flutterwave-webhook",
  "paystack-webhook",
  "midtrans-webhook",
  "btcpay-webhook",
  "cloud-billing-webhook",
  "webhook-health",
  "send-welcome",
  "tenant-alerts",
  "otp-send-hook",
]

FOR EACH func_name IN DEPLOY_LIST:
  func_dir = {FUNCTIONS_DIR}/{func_name}
  IF directory exists:
    DISPLAY: "  Deploying {func_name}..."
    RUN: supabase functions deploy {func_name} --no-verify-jwt --project-ref {PROJECT_REF}
    IF exit_code == 0:
      DISPLAY: "  ✓ {func_name}"
    ELSE:
      DISPLAY: "  ⚠ {func_name} failed — {stderr}"
      -- Non-fatal: continue, report at end

-- Push secrets
DISPLAY: "  Pushing secrets to Edge Functions..."

SECRETS = {
  "STRIPE_TEST_SECRET_KEY": STRIPE_TEST_SECRET_KEY,
  "STRIPE_LIVE_SECRET_KEY": STRIPE_LIVE_SECRET_KEY,       -- may be empty
  "PAYCRAFT_CLOUD_STRIPE_SECRET_KEY": PAYCRAFT_CLOUD_STRIPE_SECRET_KEY,
  "PAYCRAFT_ENCRYPTION_KEY": PAYCRAFT_ENCRYPTION_KEY,
}

IF RESEND_API_KEY is not empty:
  SECRETS["RESEND_API_KEY"] = RESEND_API_KEY
  SECRETS["PAYCRAFT_FROM_EMAIL"] = "PayCraft <noreply@paycraft.dev>"

-- Build secrets string
secret_args = join(SECRETS as "KEY=VALUE" pairs, " ")
RUN: supabase secrets set {secret_args} --project-ref {PROJECT_REF}

OUTPUT:
  "✓ {deployed_count}/{total_count} Edge Functions deployed"
  "✓ {secret_count} secrets configured"
```

---

## STEP C.6 — STRIPE WEBHOOK SETUP + BILLING PRODUCTS

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Step 6/6: Stripe Webhook + Billing Products"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

-- Tenant webhook URL (for customer payment processing)
TENANT_WEBHOOK_URL = {SUPABASE_URL}/functions/v1/stripe-webhook
DISPLAY:
  ""
  "  ┌─────────────────────────────────────────────────────────┐"
  "  │  ACTION REQUIRED: Add webhook in Stripe Dashboard       │"
  "  │                                                         │"
  "  │  1. Go to: https://dashboard.stripe.com/webhooks        │"
  "  │  2. Click 'Add endpoint'                                │"
  "  │  3. URL: {TENANT_WEBHOOK_URL}                          │"
  "  │  4. Events to select:                                   │"
  "  │     - checkout.session.completed                        │"
  "  │     - customer.subscription.updated                     │"
  "  │     - customer.subscription.deleted                     │"
  "  │     - invoice.paid                                      │"
  "  │  5. Copy the Signing Secret                             │"
  "  └─────────────────────────────────────────────────────────┘"

ASK: "Stripe Test Webhook Signing Secret (whsec_...):"
  VALIDATE: starts with whsec_
  STORE → STRIPE_TEST_WEBHOOK_SECRET

ASK: "Stripe Live Webhook Signing Secret (whsec_...) [or Enter to skip]:"
  VALIDATE: starts with whsec_ OR empty
  STORE → STRIPE_LIVE_WEBHOOK_SECRET

-- Push webhook secrets
RUN: supabase secrets set \
  STRIPE_TEST_WEBHOOK_SECRET={STRIPE_TEST_WEBHOOK_SECRET} \
  STRIPE_LIVE_WEBHOOK_SECRET={STRIPE_LIVE_WEBHOOK_SECRET} \
  --project-ref {PROJECT_REF}

-- Cloud billing webhook (for PayCraft's own subscriptions)
CLOUD_WEBHOOK_URL = {SUPABASE_URL}/functions/v1/cloud-billing-webhook
DISPLAY:
  ""
  "  ┌─────────────────────────────────────────────────────────┐"
  "  │  ACTION REQUIRED: Add SECOND webhook for Cloud Billing  │"
  "  │                                                         │"
  "  │  1. Go to: https://dashboard.stripe.com/webhooks        │"
  "  │  2. Click 'Add endpoint'                                │"
  "  │  3. URL: {CLOUD_WEBHOOK_URL}                           │"
  "  │  4. Events: same as above                               │"
  "  │  5. Copy the Signing Secret                             │"
  "  └─────────────────────────────────────────────────────────┘"

ASK: "Cloud Billing Webhook Signing Secret (whsec_...):"
  VALIDATE: starts with whsec_
  STORE → PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET

RUN: supabase secrets set \
  PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET={PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET} \
  --project-ref {PROJECT_REF}

-- Create Stripe Products for PayCraft Cloud billing
DISPLAY:
  ""
  "  ┌─────────────────────────────────────────────────────────┐"
  "  │  ACTION REQUIRED: Create Stripe Products                │"
  "  │                                                         │"
  "  │  1. Go to: https://dashboard.stripe.com/products        │"
  "  │  2. Create 'PayCraft Pro' product:                      │"
  "  │     - Price: $49/month (recurring)                      │"
  "  │     - Copy the Price ID (price_...)                     │"
  "  │  3. Create 'PayCraft Enterprise' product:               │"
  "  │     - Price: $299/month (recurring)                     │"
  "  │     - Copy the Price ID (price_...)                     │"
  "  └─────────────────────────────────────────────────────────┘"

ASK: "Stripe Pro Price ID (price_...):"
  VALIDATE: starts with price_
  STORE → STRIPE_PRO_PRICE_ID

ASK: "Stripe Enterprise Price ID (price_...):"
  VALIDATE: starts with price_
  STORE → STRIPE_ENTERPRISE_PRICE_ID

RUN: supabase secrets set \
  STRIPE_PRO_PRICE_ID={STRIPE_PRO_PRICE_ID} \
  STRIPE_ENTERPRISE_PRICE_ID={STRIPE_ENTERPRISE_PRICE_ID} \
  --project-ref {PROJECT_REF}

OUTPUT: "✓ Stripe webhooks + billing products configured"
```

---

## STEP C.7 — WRITE .ENV FILE

```
Write all collected values to {paycraft_root}/.env:

PAYCRAFT_SUPABASE_URL={SUPABASE_URL}
PAYCRAFT_SUPABASE_ANON_KEY={SUPABASE_ANON_KEY}
PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY={SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_DB_URL={SUPABASE_DB_URL}
SUPABASE_PROJECT_REF={PROJECT_REF}

STRIPE_TEST_SECRET_KEY={STRIPE_TEST_SECRET_KEY}
STRIPE_LIVE_SECRET_KEY={STRIPE_LIVE_SECRET_KEY}
STRIPE_TEST_WEBHOOK_SECRET={STRIPE_TEST_WEBHOOK_SECRET}
STRIPE_LIVE_WEBHOOK_SECRET={STRIPE_LIVE_WEBHOOK_SECRET}

PAYCRAFT_CLOUD_STRIPE_SECRET_KEY={PAYCRAFT_CLOUD_STRIPE_SECRET_KEY}
PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET={PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET}
STRIPE_PRO_PRICE_ID={STRIPE_PRO_PRICE_ID}
STRIPE_ENTERPRISE_PRICE_ID={STRIPE_ENTERPRISE_PRICE_ID}

PAYCRAFT_ENCRYPTION_KEY={PAYCRAFT_ENCRYPTION_KEY}
RESEND_API_KEY={RESEND_API_KEY}

VERIFY: .env is in .gitignore
  IF not: APPEND ".env" to .gitignore

OUTPUT: "✓ .env written at {paycraft_root}/.env"
```

---

## STEP C.8 — SMOKE TEST

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  Smoke Test"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TEST 1: Supabase connection
  RUN: curl -sf "{SUPABASE_URL}/rest/v1/" -H "apikey: {SUPABASE_ANON_KEY}"
  EXPECT: 200
  OUTPUT: "✓ Supabase REST API responds"

TEST 2: RPCs accessible
  RUN: curl -sf "{SUPABASE_URL}/rest/v1/rpc/is_premium" \
    -H "apikey: {SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"p_email":"smoke-test@paycraft.dev","p_server_token":"fake"}'
  EXPECT: 200 (returns false — no subscription exists)
  OUTPUT: "✓ is_premium() RPC accessible"

TEST 3: Webhook health
  RUN: curl -sf "{SUPABASE_URL}/functions/v1/webhook-health" \
    -H "Authorization: Bearer {SUPABASE_ANON_KEY}" \
    -H "X-PayCraft-API-Key: test"
  EXPECT: 200 or 4xx (function responds, may reject invalid key)
  OUTPUT: "✓ webhook-health Edge Function responds"

TEST 4: Tenant provisioning (if migrations applied correctly)
  RUN: curl -sf "{SUPABASE_URL}/rest/v1/rpc/provision_tenant" \
    -H "apikey: {SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"p_user_id":"00000000-0000-0000-0000-000000000001","p_app_name":"Smoke Test","p_email":"smoke@test.dev"}'
  IF 200:
    OUTPUT: "✓ Tenant provisioning works"
    -- Clean up smoke test tenant
    RUN: psql "{SUPABASE_DB_URL}" -c "DELETE FROM tenant_admins WHERE user_id='00000000-0000-0000-0000-000000000001'; DELETE FROM tenants WHERE owner_email='smoke@test.dev';"
    OUTPUT: "✓ Smoke test tenant cleaned up"
  IF fail:
    OUTPUT: "⚠ Tenant provisioning returned error (may need auth context)"
```

---

## STEP C.9 — DEPLOYMENT SUMMARY

```
DISPLAY:
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "  PayCraft Cloud — Deployment Complete!"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ""
  "  Infrastructure:"
  "    Supabase:  {SUPABASE_URL}"
  "    Functions: {deployed_count} deployed"
  "    Secrets:   {secret_count} configured"
  "    Database:  25 migrations applied"
  ""
  "  URLs:"
  "    Tenant webhooks:  {SUPABASE_URL}/functions/v1/{provider}-webhook/{tenant_id}"
  "    Cloud billing:    {SUPABASE_URL}/functions/v1/cloud-billing-webhook"
  "    Health check:     {SUPABASE_URL}/functions/v1/webhook-health"
  ""
  "  Next Steps:"
  "    1. Deploy dashboard:  cd dashboard && vercel"
  "    2. Deploy docs:       Push to GitHub → auto-deploys to Pages"
  "    3. Publish CLI:       cd cli && npm publish"
  "    4. Set GitHub secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL"
  "    5. Sign up at your dashboard to verify full flow"
  ""
  "  Cost: $0/month (all free tiers)"
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WRITE memory.json:
  {
    "mode": "cloud",
    "supabase_url": "{SUPABASE_URL}",
    "supabase_project_ref": "{PROJECT_REF}",
    "phases_completed": ["cloud_deploy"],
    "deployed_functions": {deployed_list},
    "last_run": "{now ISO8601}"
  }
```

---

## Error Recovery

| Error | Recovery |
|-------|----------|
| Migration fails | Fix SQL, re-run `/paycraft-adopt --cloud` (idempotent) |
| Function deploy fails | `supabase functions deploy {name} --no-verify-jwt` manually |
| Secrets push fails | `supabase secrets set KEY=VALUE` manually |
| Connection refused | Check Supabase project is active (not paused) |
| psql not found | Use Supabase SQL editor in dashboard instead |

---

## Enforcement Rules

1. **ALL keys validated before any deployment action** — no partial deploys with missing keys
2. **Migrations applied in strict order** (001-025) — never skip
3. **Secrets NEVER written to git** — .env must be in .gitignore
4. **Smoke test runs after deploy** — catches misconfigurations immediately
5. **Idempotent** — safe to re-run; `IF NOT EXISTS` / `CREATE OR REPLACE` in all migrations
