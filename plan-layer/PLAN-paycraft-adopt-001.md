# PLAN-paycraft-adopt-001 — `/paycraft-adopt` Consolidated E2E Command

**Status**: APPROVED
**Created**: 2026-04-25
**Updated**: 2026-04-25
**Author**: Rajan Maurya
**Scope**: PayCraft repo (`workspaces/mbs/PayCraft/`) + framework stub (`.claude/commands/`)

---

## Enforcement Rules (MANDATORY — apply to every phase, gate, and step)

> These rules are NEVER relaxed. No step is deferred. No step is assumed. No step is skipped based on Claude's judgment.

1. **STRICT SEQUENCE**: Every step within a phase executes in the exact order listed. No reordering.
2. **VERIFY AFTER EVERY ACTION**: Every API call, migration, deploy, or config write has an explicit verification step immediately after. If verification fails → HARD STOP with fix instructions. Never continue past a failed verification.
3. **USER ACTION GATES**: Wherever a step requires the user to act in a browser (Stripe Dashboard, Supabase Dashboard, Razorpay Dashboard) → display a numbered checklist with exact URL + exact field + what to copy → pause and ask user to confirm completion → verify the result before proceeding.
4. **TEST MODE FIRST**: Before anything live, set up Stripe test products/prices/payment links. All verification runs against test mode. Live mode is explicitly opted in at the end.
5. **NO INTELLIGENCE SHORTCUTS**: Claude must not say "this is probably fine" or "we can skip this since X". Every check runs. Every verification runs.
6. **HARD STOP FORMAT**: When a step fails:
   ```
   ✗ HARD STOP — [step name] failed
   Reason: [exact error]
   Fix: [exact numbered instructions]
   Run this step again after fixing.
   ```
7. **PHASE CHECKPOINT**: At the end of every phase, print a checkpoint summary before proceeding to the next phase. User must confirm to continue.

---

## Problem Statement

PayCraft has 8+ separate commands (`/setup`, `/setup-stripe`, `/setup-supabase`, `/paycraft-setup`, etc.) scattered across the repo and client-skills. A new adopter must:

1. Manually copy `.env.example` → `.env` and fill in secrets
2. Know which commands to run in what order
3. Switch between Stripe Dashboard, Supabase Dashboard, and Claude to complete setup
4. Separately handle client integration
5. Have no way to verify each piece works before moving on

This is friction. A single `/paycraft-adopt` command should handle **everything end-to-end** — from first `cp .env.example .env` to a verified test payment — with zero prior knowledge required.

---

## Goals

- Single command: `paycraft-adopt` in the PayCraft repo
- Asks questions interactively (never dumps a wall of instructions)
- Reads `.env` / validates keys before every API call — hard stops with exact fix instructions if missing
- Calls Supabase + Stripe MCPs where available, falls back to CLI/curl
- **Verifies every action immediately after it is taken**
- **Uses Stripe test mode throughout — test product, test price, test payment link, test webhook**
- At the end, integrates the client app directly (asks where, writes files)
- `.env.example` is the contract — all keys flow through it, nothing hardcoded

---

## Command Flow — Full Step-by-Step

```
/paycraft-adopt
  │
  ╔══════════════════════════════════════════════════════╗
  ║  PHASE 1: ENV BOOTSTRAP                              ║
  ╚══════════════════════════════════════════════════════╝
  │
  ├─ STEP 1.1 — Check .env file
  │   ACTION : test -f .env
  │   IF NOT EXISTS: cp .env.example .env
  │   VERIFY : Read .env → confirm all PAYCRAFT_ keys are present (empty OK, missing key = HARD STOP)
  │   OUTPUT : "✓ .env ready (N keys present)"
  │
  ├─ STEP 1.2 — Ask provider choice
  │   CHECK : Read PAYCRAFT_PROVIDER from .env
  │   IF EMPTY: Ask user — "Which payment provider? [1] Stripe  [2] Razorpay"
  │   ACTION : Write PAYCRAFT_PROVIDER=stripe (or razorpay) to .env
  │   VERIFY : Read .env → confirm PAYCRAFT_PROVIDER is set
  │   OUTPUT : "✓ Provider: Stripe"
  │
  ├─ STEP 1.3 — Collect Supabase credentials
  │   CHECK : Read PAYCRAFT_SUPABASE_URL, PAYCRAFT_SUPABASE_PROJECT_REF,
  │            PAYCRAFT_SUPABASE_ANON_KEY, PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY,
  │            PAYCRAFT_SUPABASE_ACCESS_TOKEN from .env
  │   FOR EACH MISSING KEY:
  │     USER ACTION GATE:
  │       "Open: https://supabase.com/dashboard/project/YOUR_REF/settings/api"
  │       "Copy [key name] and paste here:"
  │       → Write to .env
  │       VERIFY: re-read .env → confirm value written
  │   OUTPUT : "✓ Supabase credentials complete"
  │
  ├─ STEP 1.4 — Collect provider credentials
  │   [STRIPE PATH]
  │     CHECK: PAYCRAFT_STRIPE_SECRET_KEY (must start with sk_test_ or sk_live_)
  │     IF MISSING:
  │       USER ACTION GATE:
  │         "Open: https://dashboard.stripe.com/test/apikeys"
  │         "Copy the Secret key (starts with sk_test_...)"
  │         "Paste here:"
  │         → Write PAYCRAFT_STRIPE_SECRET_KEY to .env
  │         VERIFY: re-read .env → confirm value starts with sk_
  │   [RAZORPAY PATH]
  │     CHECK: PAYCRAFT_RAZORPAY_KEY_ID, PAYCRAFT_RAZORPAY_KEY_SECRET
  │     IF MISSING:
  │       USER ACTION GATE:
  │         "Open: https://dashboard.razorpay.com/app/keys (Test mode)"
  │         "Copy Key ID and Key Secret"
  │         "Paste Key ID:"; → write; "Paste Key Secret:"; → write
  │         VERIFY: both present in .env
  │   OUTPUT : "✓ Provider credentials complete"
  │
  ├─ STEP 1.5 — Ask currency + plan names/prices
  │   CHECK : PAYCRAFT_CURRENCY in .env (default: inr)
  │   ASK   : "Currency? [inr/usd/eur/gbp] (press Enter for inr)"
  │   ASK   : "How many plans? (e.g. 2 for monthly+yearly, 3 for monthly+quarterly+yearly)"
  │   FOR EACH PLAN: ask id, display name, price (in minor units), interval label
  │   WRITE : all plan values to .env as PAYCRAFT_PLAN_1_ID, PAYCRAFT_PLAN_1_NAME, etc.
  │   VERIFY: re-read .env → all plan values present
  │   OUTPUT : "✓ Plans configured: monthly ₹99 | yearly ₹799"
  │
  ├─ STEP 1.6 — Collect support email + app redirect URL
  │   CHECK : PAYCRAFT_SUPPORT_EMAIL, PAYCRAFT_APP_REDIRECT_URL in .env
  │   FOR EACH MISSING: ask and write to .env
  │   VERIFY: both present in .env
  │
  ╔══ PHASE 1 CHECKPOINT ══════════════════════════════════╗
  ║  ✓ .env bootstrapped                                   ║
  ║  ✓ Provider: [stripe/razorpay]                        ║
  ║  ✓ Supabase: [project ref]                            ║
  ║  ✓ Provider credentials: present                      ║
  ║  ✓ Plans: [N plans listed]                            ║
  ║  → Proceed to Phase 2? [Y to continue / Q to quit]    ║
  ╚════════════════════════════════════════════════════════╝
  │
  ╔══════════════════════════════════════════════════════╗
  ║  PHASE 2: SUPABASE SETUP                             ║
  ╚══════════════════════════════════════════════════════╝
  │
  ├─ STEP 2.1 — Verify Supabase project is reachable
  │   ACTION : GET https://api.supabase.com/v1/projects/{ref}
  │            Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
  │   VERIFY : HTTP 200, project status = "ACTIVE_HEALTHY"
  │   IF FAIL: HARD STOP — "Project not found or token invalid.
  │             Check PAYCRAFT_SUPABASE_PROJECT_REF and PAYCRAFT_SUPABASE_ACCESS_TOKEN"
  │   OUTPUT : "✓ Supabase project reachable: [project name]"
  │
  ├─ STEP 2.2 — Apply migration 001_create_subscriptions.sql
  │   ACTION : POST https://api.supabase.com/v1/projects/{ref}/database/query
  │            body: SQL from server/migrations/001_create_subscriptions.sql
  │   VERIFY : Query information_schema.tables WHERE table_name = 'subscriptions'
  │            → must return count = 1
  │   IF FAIL: HARD STOP — show exact error from Supabase response
  │   OUTPUT : "✓ subscriptions table created"
  │
  ├─ STEP 2.3 — Verify subscriptions table schema
  │   ACTION : Query information_schema.columns WHERE table_name = 'subscriptions'
  │   VERIFY : These columns MUST exist:
  │            id, email, provider, provider_customer_id, provider_subscription_id,
  │            plan, status, current_period_start, current_period_end,
  │            cancel_at_period_end, created_at, updated_at
  │   VERIFY : email column has UNIQUE constraint
  │            (query information_schema.table_constraints WHERE constraint_type='UNIQUE')
  │   IF ANY MISSING: HARD STOP — "Schema incomplete. Re-apply migration."
  │   OUTPUT : "✓ subscriptions schema verified (12 columns, email UNIQUE)"
  │
  ├─ STEP 2.4 — Verify RLS is enabled
  │   ACTION : Query pg_tables WHERE tablename='subscriptions' AND rowsecurity=true
  │   IF NOT ENABLED: HARD STOP — "RLS not enabled on subscriptions table.
  │                   Check migration 001 ran completely."
  │   OUTPUT : "✓ RLS enabled on subscriptions"
  │
  ├─ STEP 2.5 — Apply migration 002_create_rpcs.sql
  │   ACTION : POST database/query with SQL from server/migrations/002_create_rpcs.sql
  │   VERIFY : Query information_schema.routines WHERE routine_name = 'is_premium'
  │            → count = 1
  │   VERIFY : Query information_schema.routines WHERE routine_name = 'get_subscription'
  │            → count = 1
  │   IF FAIL: HARD STOP — show exact error
  │   OUTPUT : "✓ is_premium() RPC created"
  │            "✓ get_subscription() RPC created"
  │
  ├─ STEP 2.6 — Test is_premium() RPC with known-absent email
  │   ACTION : POST https://{ref}.supabase.co/rest/v1/rpc/is_premium
  │            Headers: apikey={ANON_KEY}, Content-Type: application/json
  │            Body: {"user_email": "test-verify@paycraft.io"}
  │   VERIFY : Response is false (not premium, expected for new email)
  │   IF FAIL: HARD STOP — "is_premium() RPC not callable.
  │             Check RLS policies allow anon SELECT."
  │   OUTPUT : "✓ is_premium() RPC callable and returns false for unknown email"
  │
  ├─ STEP 2.7 — Deploy webhook Edge Function
  │   PRE-CHECK: supabase CLI installed? (supabase --version)
  │   IF NOT INSTALLED:
  │     USER ACTION GATE:
  │       "Install Supabase CLI first:"
  │       "  brew install supabase/tap/supabase"
  │       "  OR: npm install -g supabase"
  │       "Press Enter when installed and run: supabase --version"
  │       VERIFY: supabase --version returns a version string
  │   ACTION : supabase functions deploy [provider]-webhook
  │             --project-ref {PAYCRAFT_SUPABASE_PROJECT_REF}
  │             --no-verify-jwt
  │   VERIFY : supabase functions list --project-ref {ref}
  │            → [provider]-webhook appears in list
  │   IF NOT IN LIST: HARD STOP — "Deploy failed. Check supabase CLI auth:
  │                   supabase login --token {PAYCRAFT_SUPABASE_ACCESS_TOKEN}"
  │   OUTPUT : "✓ [provider]-webhook deployed"
  │
  ├─ STEP 2.8 — Set Supabase function secrets
  │   [STRIPE PATH]
  │     ACTION : supabase secrets set STRIPE_SECRET_KEY={PAYCRAFT_STRIPE_SECRET_KEY}
  │               --project-ref {ref}
  │     VERIFY : supabase secrets list --project-ref {ref} | grep STRIPE_SECRET_KEY
  │     OUTPUT : "✓ STRIPE_SECRET_KEY secret set on function"
  │   [RAZORPAY PATH]
  │     ACTION : supabase secrets set RAZORPAY_KEY_SECRET={PAYCRAFT_RAZORPAY_KEY_SECRET}
  │               --project-ref {ref}
  │     VERIFY : secret appears in list
  │     OUTPUT : "✓ RAZORPAY_KEY_SECRET secret set on function"
  │
  ├─ STEP 2.9 — Test webhook endpoint is reachable (no-auth smoke test)
  │   ACTION : POST https://{ref}.supabase.co/functions/v1/[provider]-webhook
  │            Body: {} (empty, no signature)
  │   VERIFY : HTTP response is 400 (bad request — expected, means function is live
  │            but correctly rejects unsigned payloads)
  │            NOT 401 (JWT required — means --no-verify-jwt not applied)
  │            NOT 404 (not deployed)
  │   IF 401: HARD STOP — "Function deployed with JWT verification ON.
  │            Re-deploy: supabase functions deploy [provider]-webhook --no-verify-jwt"
  │   IF 404: HARD STOP — "Function not found. Re-run Step 2.7."
  │   OUTPUT : "✓ Webhook endpoint live at https://{ref}.supabase.co/functions/v1/[provider]-webhook"
  │
  ╔══ PHASE 2 CHECKPOINT ══════════════════════════════════╗
  ║  ✓ Supabase project reachable                          ║
  ║  ✓ subscriptions table (12 cols, UNIQUE email, RLS)   ║
  ║  ✓ is_premium() RPC — callable                        ║
  ║  ✓ get_subscription() RPC — callable                  ║
  ║  ✓ [provider]-webhook deployed (--no-verify-jwt)      ║
  ║  ✓ Function secrets set                               ║
  ║  ✓ Webhook endpoint returns 400 (not 401/404)         ║
  ║  → Proceed to Phase 3? [Y to continue / Q to quit]    ║
  ╚════════════════════════════════════════════════════════╝
  │
  ╔══════════════════════════════════════════════════════╗
  ║  PHASE 3: PROVIDER SETUP (STRIPE PATH)               ║
  ╚══════════════════════════════════════════════════════╝
  │  (Razorpay path: see Phase 3B below — identical structure, different API calls)
  │
  ├─ STEP 3.1 — Verify Stripe connection (test mode)
  │   ACTION : mcp__stripe__get_stripe_account_info
  │   VERIFY : Response contains account ID (acct_...)
  │   VERIFY : livemode = false (MUST be test mode at this stage)
  │   IF livemode=true: HARD STOP — "Stripe MCP is connected to LIVE mode.
  │             Use test key sk_test_... for initial setup.
  │             Update PAYCRAFT_STRIPE_SECRET_KEY to your test key."
  │   OUTPUT : "✓ Stripe connected (TEST MODE) — account: [acct_id]"
  │
  ├─ STEP 3.2 — Create test Product
  │   ACTION : mcp__stripe__create_product
  │            name="[AppName] Premium (TEST)"
  │            description="PayCraft test product — safe to delete"
  │            metadata={paycraft_test: "true", paycraft_version: "adopt"}
  │   VERIFY : mcp__stripe__fetch_stripe_resources resource=products
  │            → product with name "[AppName] Premium (TEST)" exists
  │   CAPTURE: product_id → write PAYCRAFT_STRIPE_TEST_PRODUCT_ID to .env
  │   OUTPUT : "✓ Test product created: [product_id]"
  │
  ├─ STEP 3.3 — Create test Prices (one per plan)
  │   FOR EACH PLAN in .env (PAYCRAFT_PLAN_1..N):
  │     ACTION : mcp__stripe__create_price
  │              product={product_id}
  │              unit_amount={plan_price_minor_units}
  │              currency={PAYCRAFT_CURRENCY}
  │              recurring.interval={monthly→month / quarterly→month+interval_count:3 / yearly→year}
  │              nickname="[plan_id] test"
  │     VERIFY : mcp__stripe__list_prices → price with nickname "[plan_id] test" exists
  │     CAPTURE: price_id → write PAYCRAFT_STRIPE_TEST_PRICE_{PLAN_ID} to .env
  │   OUTPUT : "✓ Test prices created: [N prices]"
  │
  ├─ STEP 3.4 — Create test Payment Links (one per plan)
  │   FOR EACH PLAN:
  │     ACTION : mcp__stripe__create_payment_link
  │              line_items=[{price: price_id, quantity: 1}]
  │              metadata={paycraft_plan: plan_id, paycraft_test: "true"}
  │              after_completion.type=redirect
  │              after_completion.redirect.url={PAYCRAFT_APP_REDIRECT_URL}
  │     VERIFY : mcp__stripe__fetch_stripe_resources resource=payment_links
  │              → link with plan metadata exists and is active
  │     CAPTURE: payment_link_url → write PAYCRAFT_STRIPE_LINK_{PLAN_ID} to .env
  │   OUTPUT : "✓ Test payment links:
  │             monthly  → https://buy.stripe.com/test/...
  │             yearly   → https://buy.stripe.com/test/..."
  │
  ├─ STEP 3.5 — Create Webhook endpoint in Stripe Dashboard
  │   USER ACTION GATE:
  │     "Now create the webhook endpoint in Stripe Dashboard:"
  │     "1. Open: https://dashboard.stripe.com/test/webhooks"
  │     "2. Click 'Add endpoint'"
  │     "3. Endpoint URL: https://{ref}.supabase.co/functions/v1/stripe-webhook"
  │     "4. Select events:"
  │        "   ✓ checkout.session.completed"
  │        "   ✓ customer.subscription.updated"
  │        "   ✓ customer.subscription.deleted"
  │        "   ✓ invoice.paid"
  │     "5. Click 'Add endpoint'"
  │     "6. On the endpoint detail page, click 'Reveal' under Signing secret"
  │     "7. Copy the signing secret (starts with whsec_...)"
  │     "8. Paste it here:"
  │   VALIDATE: value starts with "whsec_"
  │   IF NOT: HARD STOP — "Invalid webhook secret format. Must start with whsec_"
  │   ACTION : Write PAYCRAFT_STRIPE_WEBHOOK_SECRET to .env
  │   ACTION : supabase secrets set STRIPE_WEBHOOK_SECRET={secret} --project-ref {ref}
  │   VERIFY : supabase secrets list --project-ref {ref} | grep STRIPE_WEBHOOK_SECRET
  │   OUTPUT : "✓ Webhook signing secret set"
  │
  ├─ STEP 3.6 — Verify webhook signature flow end-to-end
  │   ACTION : Use Stripe CLI to send test event (if available):
  │            stripe trigger checkout.session.completed
  │              --add checkout_session:metadata.email=test-verify@paycraft.io
  │            OR: mcp__stripe__stripe_api_execute
  │              POST /v1/webhook_endpoints/{id}/test_events
  │              { "type": "checkout.session.completed" }
  │   VERIFY : Supabase function logs show "Processing subscription event"
  │            (check via: supabase functions logs stripe-webhook --project-ref {ref})
  │   NOTE   : Full DB write verification happens in Phase 5 (Step 5.3)
  │   OUTPUT : "✓ Webhook signature verification passed"
  │
  ├─ STEP 3.7 — Enable Customer Portal
  │   USER ACTION GATE:
  │     "Enable the Stripe Customer Portal:"
  │     "1. Open: https://dashboard.stripe.com/test/settings/billing/portal"
  │     "2. Activate the portal (toggle ON)"
  │     "3. Under 'Business information', set your app name and support email"
  │     "4. Click 'Save changes'"
  │     "5. Copy the portal link from 'Portal link' section"
  │     "6. Paste the portal URL here:"
  │   VALIDATE: value starts with "https://billing.stripe.com"
  │   ACTION : Write PAYCRAFT_STRIPE_PORTAL_URL to .env
  │   VERIFY : re-read .env → PAYCRAFT_STRIPE_PORTAL_URL is set
  │   OUTPUT : "✓ Customer portal URL saved"
  │
  ╔══ PHASE 3 CHECKPOINT ══════════════════════════════════╗
  ║  ✓ Stripe connected (TEST MODE)                        ║
  ║  ✓ Test product created                               ║
  ║  ✓ Test prices created (N plans)                      ║
  ║  ✓ Test payment links created (N links)               ║
  ║  ✓ Webhook endpoint created in Stripe Dashboard       ║
  ║  ✓ Webhook signing secret set (Supabase + .env)       ║
  ║  ✓ Webhook signature verification passed              ║
  ║  ✓ Customer portal URL saved                          ║
  ║  → Proceed to Phase 4? [Y to continue / Q to quit]    ║
  ╚════════════════════════════════════════════════════════╝
  │
  ╔══════════════════════════════════════════════════════╗
  ║  PHASE 3B: PROVIDER SETUP (RAZORPAY PATH)            ║
  ╚══════════════════════════════════════════════════════╝
  │  (Runs INSTEAD of Phase 3 when PAYCRAFT_PROVIDER=razorpay)
  │
  ├─ STEP 3B.1 — Verify Razorpay connection
  │   ACTION : GET https://api.razorpay.com/v1/accounts
  │            Basic auth: {PAYCRAFT_RAZORPAY_KEY_ID}:{PAYCRAFT_RAZORPAY_KEY_SECRET}
  │   VERIFY : HTTP 200
  │   IF FAIL: HARD STOP — "Razorpay credentials invalid. Check KEY_ID and KEY_SECRET."
  │   OUTPUT : "✓ Razorpay connected"
  │
  ├─ STEP 3B.2 — Create subscription plans
  │   FOR EACH PLAN: POST /v1/plans with period, interval, item.amount, item.currency
  │   VERIFY : GET /v1/plans/{plan_id} → status=created
  │   CAPTURE: plan_id → write PAYCRAFT_RAZORPAY_PLAN_{ID} to .env
  │   OUTPUT : "✓ Razorpay plans created"
  │
  ├─ STEP 3B.3 — Create Payment Links
  │   FOR EACH PLAN: POST /v1/payment_links with amount, currency, description
  │   VERIFY : GET /v1/payment_links/{id} → status=created
  │   CAPTURE: short_url → write PAYCRAFT_RAZORPAY_LINK_{PLAN_ID} to .env
  │   OUTPUT : "✓ Razorpay payment links created"
  │
  ├─ STEP 3B.4 — Create Webhook endpoint
  │   USER ACTION GATE:
  │     "Create webhook in Razorpay Dashboard:"
  │     "1. Open: https://dashboard.razorpay.com/app/webhooks"
  │     "2. Click 'Add New Webhook'"
  │     "3. Webhook URL: https://{ref}.supabase.co/functions/v1/razorpay-webhook"
  │     "4. Select events: payment.captured, subscription.activated, subscription.cancelled"
  │     "5. Set a webhook secret and copy it"
  │     "6. Paste the webhook secret here:"
  │   ACTION : Write PAYCRAFT_RAZORPAY_WEBHOOK_SECRET to .env
  │   ACTION : supabase secrets set RAZORPAY_WEBHOOK_SECRET={secret} --project-ref {ref}
  │   VERIFY : secret appears in supabase secrets list
  │   OUTPUT : "✓ Razorpay webhook secret set"
  │
  ╔══ PHASE 4: CLIENT INTEGRATION ═════════════════════════╗
  ╚════════════════════════════════════════════════════════╝
  │
  ├─ STEP 4.1 — Ask target app path
  │   ASK: "Which KMP app should I integrate billing into?"
  │         "Enter the absolute path to your app (or 'skip' to get manual code):"
  │   IF SKIP: generate PayCraft.configure() code block → print → Phase 4 done
  │   VALIDATE: path exists on filesystem
  │   IF NOT EXISTS: HARD STOP — "Path not found. Enter the correct absolute path."
  │   DETECT: find libs.versions.toml, settings.gradle.kts, shared/build.gradle.kts
  │   IF NOT FOUND: HARD STOP — "Not a KMP project (no libs.versions.toml found).
  │                Check the path and try again."
  │   OUTPUT : "✓ KMP project found at [path]"
  │
  ├─ STEP 4.2 — Check PayCraft version on Maven Central
  │   ACTION : GET https://central.sonatype.com/api/v1/publisher/search?q=paycraft
  │            OR read gradle/libs.versions.toml for existing paycraft entry
  │   CAPTURE: latest stable version
  │   OUTPUT : "Latest PayCraft version: [version]"
  │
  ├─ STEP 4.3 — Add PayCraft dependency
  │   ACTION : Read {app}/gradle/libs.versions.toml
  │   CHECK  : Is paycraft already in [libraries]?
  │   IF YES : Read current version → compare to latest → offer to update
  │   IF NO  : Edit libs.versions.toml:
  │             Add under [versions]: paycraft = "[latest]"
  │             Add under [libraries]: paycraft = { module = "io.github.mobilebytelabs:paycraft", version.ref = "paycraft" }
  │   ACTION : Read shared/build.gradle.kts (or commonMain module)
  │   CHECK  : Is libs.paycraft already in commonMain.dependencies?
  │   IF NO  : Edit → add implementation(libs.paycraft) under commonMain.dependencies
  │   VERIFY : Read both files back → confirm entries present
  │   OUTPUT : "✓ PayCraft dependency added to Gradle"
  │
  ├─ STEP 4.4 — Locate app initialization file
  │   SEARCH : Find Application.kt, App.kt, or file containing startKoin {}
  │   IF NOT FOUND: Ask user — "Where is your app initialization file? (relative path)"
  │   VALIDATE: file exists
  │   OUTPUT : "✓ App init file found: [path]"
  │
  ├─ STEP 4.5 — Generate PayCraft.configure() from .env values
  │   READ   : All PAYCRAFT_* values from .env
  │   GENERATE:
  │     PayCraft.configure {
  │         supabase(
  │             url = "[PAYCRAFT_SUPABASE_URL]",
  │             anonKey = "[PAYCRAFT_SUPABASE_ANON_KEY]",
  │         )
  │         provider(
  │             StripeProvider(   // or RazorpayProvider
  │                 paymentLinks = mapOf(
  │                     "[plan_id]" to "[PAYCRAFT_STRIPE_LINK_{ID}]",
  │                     ...
  │                 ),
  │                 customerPortalUrl = "[PAYCRAFT_STRIPE_PORTAL_URL]",
  │             )
  │         )
  │         plans(
  │             BillingPlan(id="...", name="...", price="...", interval="...", rank=N),
  │             ...
  │         )
  │         benefits(
  │             BillingBenefit(icon = Icons.Default.Star, text = "Unlock all features"),
  │             BillingBenefit(icon = Icons.Default.Block, text = "Ad-free experience"),
  │         )
  │         supportEmail("[PAYCRAFT_SUPPORT_EMAIL]")
  │     }
  │   ACTION : Write block BEFORE startKoin {} in app init file
  │   VERIFY : Read app init file → PayCraft.configure block is present
  │   OUTPUT : "✓ PayCraft.configure() written"
  │
  ├─ STEP 4.6 — Add PayCraftModule to Koin
  │   ACTION : Read app init file → find startKoin { modules(...) }
  │   CHECK  : Is PayCraftModule already in the list?
  │   IF NO  : Edit → append PayCraftModule to modules list
  │   VERIFY : Read file → PayCraftModule present in modules list
  │   OUTPUT : "✓ PayCraftModule added to Koin"
  │
  ├─ STEP 4.7 — Add PayCraft UI to SettingsScreen
  │   SEARCH : Find SettingsScreen.kt (or ask user for path)
  │   READ   : SettingsScreen.kt content
  │   CHECK  : PayCraftBanner already present?
  │   IF NO  :
  │     Add state vars: showPaywall, showRestore
  │     Add PayCraftBanner(onClick=..., onRestoreClick=...) in screen body
  │     Add PayCraftSheet + PayCraftRestore overlays
  │     Add imports for PayCraftBanner, PayCraftSheet, PayCraftRestore
  │   VERIFY : Read file → all 3 components present, all imports present
  │   OUTPUT : "✓ PayCraft UI added to SettingsScreen"
  │
  ├─ STEP 4.8 — Ask where to store API keys in the app
  │   ASK: "Where does your app manage API keys?"
  │         "[1] local.properties + BuildConfig  [2] Config.kt constants  [3] Other (specify)"
  │   BASED ON CHOICE:
  │     [1]: Add to local.properties: SUPABASE_URL=... SUPABASE_ANON_KEY=...
  │          Verify local.properties readable, add to .gitignore if not present
  │     [2]: Locate Config.kt → add constants or update existing ones
  │     [3]: Ask path → write to specified file
  │   VERIFY : Read target file → both SUPABASE_URL and SUPABASE_ANON_KEY present
  │   OUTPUT : "✓ API keys written to [target]"
  │
  ╔══ PHASE 4 CHECKPOINT ══════════════════════════════════╗
  ║  ✓ PayCraft dependency in Gradle                       ║
  ║  ✓ PayCraft.configure() in app init                   ║
  ║  ✓ PayCraftModule in Koin                             ║
  ║  ✓ PayCraft UI in SettingsScreen                      ║
  ║  ✓ API keys in app key storage                        ║
  ║  → Proceed to Phase 5? [Y to continue / Q to quit]    ║
  ╚════════════════════════════════════════════════════════╝
  │
  ╔══════════════════════════════════════════════════════╗
  ║  PHASE 5: END-TO-END VERIFICATION                    ║
  ╚══════════════════════════════════════════════════════╝
  │
  ├─ STEP 5.1 — Re-verify Supabase schema (fresh check)
  │   ACTION : Query information_schema.tables + routines
  │   VERIFY : subscriptions table exists
  │   VERIFY : is_premium() exists
  │   VERIFY : get_subscription() exists
  │   VERIFY : email UNIQUE constraint exists
  │   PASS/FAIL per item → if any FAIL: HARD STOP pointing to Phase 2
  │   OUTPUT : "✓ Supabase schema complete"
  │
  ├─ STEP 5.2 — Re-verify webhook is live
  │   ACTION : POST webhook URL with empty body
  │   VERIFY : HTTP 400 (not 401, not 404)
  │   OUTPUT : "✓ Webhook endpoint live"
  │
  ├─ STEP 5.3 — Simulate subscription write (test data)
  │   ACTION : INSERT test row directly into subscriptions via service role:
  │            POST https://{ref}.supabase.co/rest/v1/subscriptions
  │            Headers: apikey={SERVICE_ROLE_KEY}, Authorization: Bearer {SERVICE_ROLE_KEY}
  │            Body: {email: "e2e-test@paycraft.io", provider: "stripe",
  │                   provider_subscription_id: "sub_test_verify",
  │                   plan: "monthly", status: "active"}
  │   VERIFY : GET subscriptions?email=eq.e2e-test@paycraft.io
  │            → row exists with status=active
  │   IF FAIL: HARD STOP — "Cannot write to subscriptions table.
  │             Check RLS policy has WITH CHECK clause for service_role."
  │   OUTPUT : "✓ subscriptions table writable via service role"
  │
  ├─ STEP 5.4 — Verify is_premium() returns true for test row
  │   ACTION : POST /rpc/is_premium body={user_email: "e2e-test@paycraft.io"}
  │            Headers: apikey={ANON_KEY}
  │   VERIFY : Response is true
  │   IF FAIL: HARD STOP — "is_premium() returns false for active subscription.
  │             Check RPC logic in 002_create_rpcs.sql."
  │   OUTPUT : "✓ is_premium() returns true for active subscriber"
  │
  ├─ STEP 5.5 — Verify get_subscription() returns correct data
  │   ACTION : POST /rpc/get_subscription body={user_email: "e2e-test@paycraft.io"}
  │            Headers: apikey={ANON_KEY}
  │   VERIFY : Response contains plan="monthly", status="active"
  │   IF FAIL: HARD STOP
  │   OUTPUT : "✓ get_subscription() returns correct subscription data"
  │
  ├─ STEP 5.6 — Clean up test row
  │   ACTION : DELETE subscriptions WHERE email=e2e-test@paycraft.io
  │            (via service role key)
  │   VERIFY : GET subscriptions?email=eq.e2e-test@paycraft.io → 0 rows
  │   OUTPUT : "✓ Test data cleaned up"
  │
  ├─ STEP 5.7 — Verify payment links are accessible
  │   FOR EACH PAYCRAFT_STRIPE_LINK_* in .env:
  │     VERIFY : URL is not empty
  │     VERIFY : URL starts with https://buy.stripe.com/test/ (test mode)
  │   OUTPUT : "✓ All [N] payment links configured"
  │
  ├─ STEP 5.8 — Client app build check (if Phase 4 ran)
  │   ACTION : cd {app_path} && ./gradlew :shared:compileKotlinMetadata --no-daemon
  │            (dry-run compile, not full build)
  │   VERIFY : Exit code 0
  │   IF FAIL: Display compiler errors → HARD STOP
  │            "Fix compilation errors before proceeding."
  │   OUTPUT : "✓ App compiles with PayCraft dependency"
  │
  ├─ STEP 5.9 — Generate final summary + live mode instructions
  │   PRINT final status table (all 20+ checks, each ✓ or ✗)
  │   PRINT live mode upgrade checklist:
  │     "When ready to go live:"
  │     "1. Replace PAYCRAFT_STRIPE_SECRET_KEY with sk_live_... in .env"
  │     "2. Re-run /paycraft-adopt-stripe with --live flag to create live products/links"
  │     "3. Create a LIVE webhook at https://dashboard.stripe.com/webhooks"
  │        "   (same events, same URL)"
  │     "4. Update PAYCRAFT_STRIPE_WEBHOOK_SECRET with live whsec_..."
  │     "5. Update app BuildConfig with live SUPABASE_ANON_KEY (same key works)"
  │     "6. Test with a real ₹1 payment before launch"
  │
  ╔══ PHASE 5 CHECKPOINT (FINAL) ══════════════════════════╗
  ║  ✓ Supabase schema verified                            ║
  ║  ✓ Webhook live (400 on unsigned)                     ║
  ║  ✓ DB write + RLS verified                            ║
  ║  ✓ is_premium() returns true for active sub           ║
  ║  ✓ get_subscription() returns correct data            ║
  ║  ✓ Test data cleaned up                               ║
  ║  ✓ Payment links configured (test mode)               ║
  ║  ✓ App compiles                                       ║
  ║                                                        ║
  ║  PayCraft is fully operational in TEST MODE            ║
  ║  See live mode upgrade checklist above.                ║
  ╚════════════════════════════════════════════════════════╝
```

---

## Gaps Being Closed

| Gap | Description | Phase Closed |
|-----|-------------|-------------|
| G1 | No single entry-point command | Command creation |
| G2 | `.env` bootstrap is manual | Phase 1 |
| G3 | Supabase setup requires CLI knowledge | Phase 2 |
| G4 | Stripe setup requires manual dashboard work | Phase 3 |
| G5 | No verification after each action | All phases (inline verify steps) |
| G6 | No test mode setup — developers run live by mistake | Phase 3 (test mode enforced) |
| G7 | Client integration is a separate disconnected step | Phase 4 |
| G8 | Key management guidance missing | Phase 4.8 |
| G9 | No unified end-to-end verification | Phase 5 |
| G10 | Payment link URLs not written back to .env | Phase 3.4 |
| G11 | Webhook secret not set on Supabase function automatically | Phase 3.5 |
| G12 | No DB write smoke test | Phase 5.3–5.5 |

---

## Files to Create

### PayCraft Repo

| File | Type | Description |
|------|------|-------------|
| `layers/paycraft/commands/paycraft-adopt.md` | New | Main orchestrator — runs phases 1–5 in sequence |
| `layers/paycraft/commands/paycraft-adopt-env.md` | New | Phase 1: env bootstrap + key validation |
| `layers/paycraft/commands/paycraft-adopt-supabase.md` | New | Phase 2: Supabase migrations + webhook deploy + 9 verify steps |
| `layers/paycraft/commands/paycraft-adopt-stripe.md` | New | Phase 3: Stripe test setup (product/price/links/webhook/portal) + 7 verify steps |
| `layers/paycraft/commands/paycraft-adopt-razorpay.md` | New | Phase 3B: Razorpay setup (plans/links/webhook) + verify steps |
| `layers/paycraft/commands/paycraft-adopt-client.md` | New | Phase 4: client app integration (Gradle + configure + Koin + UI) |
| `layers/paycraft/commands/paycraft-adopt-verify.md` | New | Phase 5: 9-step E2E verification including live DB write test |
| `.claude/commands/paycraft-adopt.md` | New | Stub pointing to above (CLI skill registration) |

### Framework Repo (stub only)

| File | Type | Description |
|------|------|-------------|
| `.claude/commands/paycraft-adopt.md` | New | Stub for framework-level `/paycraft-adopt` |

---

## Files to Update

| File | Change |
|------|--------|
| `docs/CLAUDE_SKILLS.md` | Add `/paycraft-adopt` as primary recommended command |
| `docs/QUICK_START.md` | Update Option A to reference `/paycraft-adopt` |
| `CLAUDE.md` | Add `/paycraft-adopt` to Commands table |

---

## Key Design Decisions

### D1: `.env` is single source of truth
All keys flow through `.env`. The command reads from `.env` at every phase start, writes back after Phase 3 (payment links + webhook secret). No hardcoded values anywhere.

### D2: Hard stop on EVERY failed verification
Every action is immediately followed by a verification query. If verification fails → HARD STOP with structured error block + exact fix instructions. Claude never says "let's assume it worked".

### D3: Test mode is mandatory first
Phase 3 enforces `livemode=false` on the Stripe connection. All products, prices, payment links are created in test mode. Live mode requires a separate opt-in step (documented in Phase 5 final output). This prevents accidental live charges during setup.

### D4: User Action Gates are blocking
When a step requires browser action (Stripe Dashboard, Supabase Dashboard), the command displays a numbered checklist with exact URLs, exact field names, and what to copy. It then PAUSES and waits for the user to confirm before continuing. It never skips these or assumes the user did them.

### D5: Provider-agnostic branching
Phase 3 branches on `PAYCRAFT_PROVIDER`. Stripe uses `mcp__stripe__*` tools. Razorpay uses curl to Razorpay API. Phase 2 and Phase 5 are identical for both providers.

### D6: Idempotent by default
Every Supabase migration uses `IF NOT EXISTS`. Re-running is safe. Phase 5 is safe to re-run independently.

### D7: Sub-commands are independently callable
Each phase file is a standalone command. `/paycraft-adopt` calls them in sequence. Users can re-run just Phase 3 after rotating Stripe keys, or just Phase 5 to re-verify.

### D8: Phase checkpoints require user confirmation
At the end of each phase, a checkpoint summary is printed. The command waits for `[Y to continue]` before starting the next phase. This gives the user visibility and a clear pause point.

### D9: E2E DB smoke test
Phase 5 writes a real test row to the subscriptions table (via service role key), queries it with the anon key through RPCs, verifies the result, then deletes it. This is the definitive proof that the full stack works — DB write, RLS policy, RPC logic, and key configuration.

---

## Implementation Order (Gates)

```
Gate 1 : Create layers/paycraft/commands/ directory
Gate 2 : paycraft-adopt.md — orchestrator (5-phase flow, checkpoint prompts)
Gate 3 : paycraft-adopt-env.md — Phase 1 (6 steps)
Gate 4 : paycraft-adopt-supabase.md — Phase 2 (9 steps + checkpoint)
Gate 5 : paycraft-adopt-stripe.md — Phase 3 (7 steps + checkpoint)
Gate 6 : paycraft-adopt-razorpay.md — Phase 3B (4 steps + checkpoint)
Gate 7 : paycraft-adopt-client.md — Phase 4 (8 steps + checkpoint)
Gate 8 : paycraft-adopt-verify.md — Phase 5 (9 steps + final summary)
Gate 9 : .claude/commands/paycraft-adopt.md — CLI stub
Gate 10: Update docs (CLAUDE_SKILLS.md, QUICK_START.md, CLAUDE.md)
```

Gates 5 and 6 can be implemented in parallel. All other gates are sequential.

---

## Total Verification Checkpoints

| Phase | Steps | Inline Verifies | User Action Gates |
|-------|------:|----------------:|------------------:|
| 1 – ENV | 6 | 6 | 2 (Supabase keys, provider keys) |
| 2 – Supabase | 9 | 9 | 1 (CLI install if missing) |
| 3 – Stripe | 7 | 7 | 2 (webhook endpoint, portal) |
| 3B – Razorpay | 4 | 4 | 1 (webhook endpoint) |
| 4 – Client | 8 | 5 | 1 (key storage location) |
| 5 – Verify | 9 | 9 | 0 (fully automated) |
| **Total** | **43** | **40** | **6** |

Every step produces a `✓` or triggers a HARD STOP. There is no middle ground.

---

## Success Criteria

A developer who has never used PayCraft should be able to:

1. Clone PayCraft repo
2. Run `/paycraft-adopt` in Claude Code
3. Answer ~12 questions across the session
4. Complete ~6 browser-based user actions (with exact step-by-step instructions)
5. End with a verified, fully functional billing system in TEST MODE in their KMP app
6. Receive a clear checklist to switch to live mode when ready

Total elapsed time target: **< 25 minutes** (from clone to verified test setup).

---

## Out of Scope

- Maven Central publishing (`/release-paycraft` handles this)
- Adding new providers beyond Stripe/Razorpay (`/add-provider` handles this)
- Design customization of the paywall UI (`/customization` guide)
- Multi-app deployments (one invocation = one app)
- Switching from test to live mode (documented as next steps in Phase 5 output, not automated)
