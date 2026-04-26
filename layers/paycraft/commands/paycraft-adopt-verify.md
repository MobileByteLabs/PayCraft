# paycraft-adopt-verify — Phase 5: End-to-End Verification

> **PHASE 5 of 5** — Verifies the entire stack is operational.
> 9 steps. Fully automated — no user action gates.
> Writes a real row to the DB, reads it back through RPCs, then deletes it.
> HARD STOP on any failed check. Print final live mode checklist at the end.

---

## Prerequisites (verify before starting)

Read `.env` → confirm:
- `PAYCRAFT_SUPABASE_URL` non-empty
- `PAYCRAFT_SUPABASE_ANON_KEY` non-empty
- `PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY` non-empty
- `PAYCRAFT_PROVIDER` non-empty
- At least one payment link key non-empty

IF ANY MISSING: HARD STOP — "Run Phases 1–3 first."

---

## Phase 5 Steps

### STEP 5.1 — Re-verify Supabase schema (fresh read, 4 individual queries)

```
BASE_URL: https://api.supabase.com/v1/projects/[PAYCRAFT_SUPABASE_PROJECT_REF]/database/query
AUTH    : Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]

Query 1: SELECT COUNT(*) AS cnt FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'subscriptions'
  VERIFY: cnt = 1
  IF NOT: HARD STOP — "subscriptions table not found. Re-run Phase 2 Step 2.2."
  OUTPUT: "  ✓ subscriptions table exists"

Query 2: SELECT COUNT(*) AS cnt FROM information_schema.routines
         WHERE routine_schema = 'public' AND routine_name = 'is_premium'
  VERIFY: cnt = 1
  IF NOT: HARD STOP — "is_premium() RPC not found. Re-run Phase 2 Step 2.6."
  OUTPUT: "  ✓ is_premium() RPC exists"

Query 3: SELECT COUNT(*) AS cnt FROM information_schema.routines
         WHERE routine_schema = 'public' AND routine_name = 'get_subscription'
  VERIFY: cnt = 1
  IF NOT: HARD STOP — "get_subscription() RPC not found. Re-run Phase 2 Step 2.6."
  OUTPUT: "  ✓ get_subscription() RPC exists"

Query 4: SELECT COUNT(*) AS cnt FROM information_schema.table_constraints
         WHERE table_schema = 'public' AND table_name = 'subscriptions'
           AND constraint_type = 'UNIQUE'
  VERIFY: cnt ≥ 1
  IF NOT: HARD STOP — "UNIQUE constraint missing on subscriptions. Re-run Phase 2 Step 2.4."
  OUTPUT: "  ✓ UNIQUE constraint on email"

OUTPUT  : "✓ Schema check:  table ✓  is_premium() ✓  get_subscription() ✓  UNIQUE ✓"
```

### STEP 5.2 — Re-verify webhook is live

```
ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/functions/v1/[provider]-webhook
          Header: Content-Type: application/json
          Body: {}
VERIFY  : HTTP 400 (unsigned rejection — function live, JWT off)
IF 401  : HARD STOP — "Webhook returned 401 (JWT required). Re-deploy with --no-verify-jwt."
IF 404  : HARD STOP — "Webhook returned 404. Re-run Phase 2 Step 2.8."
IF 500  : HARD STOP — "Webhook crashed (500). Check logs:
                       supabase functions logs [provider]-webhook --project-ref [ref]"
OUTPUT  : "✓ Webhook live — returns 400 for unsigned (correct)"
```

### STEP 5.3 — Write test subscription row (service role)

```
DISPLAY : "Writing test row to subscriptions table via service role key..."

READ    : PAYCRAFT_PLAN_1_ID from .env
IF EMPTY:
  HARD STOP: "PAYCRAFT_PLAN_1_ID not set. Re-run Phase 1 to configure plans."

PRE-CLEAN (idempotency — delete any leftover row from prior runs):
ACTION  : DELETE https://[PAYCRAFT_SUPABASE_URL]/rest/v1/subscriptions
          ?email=eq.e2e-verify@paycraft.io
          Header: apikey: [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          Header: Authorization: Bearer [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          (OK if 0 rows deleted — just ensures clean state)
VERIFY  : HTTP 200 or 204 (delete succeeded or no rows)

ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/rest/v1/subscriptions
          Header: apikey: [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          Header: Authorization: Bearer [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          Header: Content-Type: application/json
          Header: Prefer: return=representation
          Body:
          {
            "email": "e2e-verify@paycraft.io",
            "provider": "[PAYCRAFT_PROVIDER]",
            "provider_subscription_id": "sub_paycraft_e2e_verify",
            "plan": "[PAYCRAFT_PLAN_1_ID]",
            "status": "active",
            "current_period_start": "[current UTC time in ISO8601 format — e.g. 2026-04-25T10:00:00Z]",
            "current_period_end": "[30 days from now in UTC — e.g. 2026-05-25T10:00:00Z]",
            "cancel_at_period_end": false
          }
          NOTE: Timestamps MUST use UTC (Z suffix). is_premium() checks current_period_end > now()
                using Postgres now() which is UTC. Non-UTC timestamps may cause is_premium() to
                return false even for a correctly inserted row.

VERIFY  : HTTP 201 (created)
IF HTTP 409 (conflict): Pre-clean didn't work — row still exists. Try again after manual cleanup:
  DISPLAY: "Run manually: DELETE FROM subscriptions WHERE email = 'e2e-verify@paycraft.io';"
  HARD STOP: "Conflict on test row insert. Clean up manually then re-run Step 5.3."
IF HTTP 403:
  HARD STOP: "INSERT rejected (403).
              RLS policy is blocking service_role inserts.
              Fix: DROP POLICY 'Service role manages subscriptions' ON subscriptions;
                   CREATE POLICY 'Service role manages subscriptions'
                     ON subscriptions FOR ALL
                     USING (auth.role() = 'service_role')
                     WITH CHECK (auth.role() = 'service_role');"
IF HTTP 500:
  HARD STOP: "INSERT failed (500): [response body]
              Check PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY is the service_role key (not anon)."
OUTPUT  : "✓ Test row written to subscriptions (email: e2e-verify@paycraft.io)"
```

### STEP 5.4 — Read test row back (service role SELECT)

```
ACTION  : GET https://[PAYCRAFT_SUPABASE_URL]/rest/v1/subscriptions
          ?email=eq.e2e-verify@paycraft.io
          Header: apikey: [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          Header: Authorization: Bearer [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]

VERIFY  : HTTP 200 AND response is a non-empty JSON array
VERIFY  : response[0].status = "active"
VERIFY  : response[0].provider = "[PAYCRAFT_PROVIDER]"
IF EMPTY ARRAY:
  HARD STOP: "Test row not found after INSERT.
              Did INSERT succeed? Check HTTP response from Step 5.3."
IF status != active:
  HARD STOP: "Test row has status=[status], expected 'active'."
OUTPUT  : "✓ Test row confirmed in subscriptions (status: active)"
```

### STEP 5.5 — Verify is_premium() returns true for test row

```
ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/rest/v1/rpc/is_premium
          Header: apikey: [PAYCRAFT_SUPABASE_ANON_KEY]
          Header: Content-Type: application/json
          Body: {"user_email": "e2e-verify@paycraft.io"}

VERIFY  : HTTP 200
VERIFY  : Parse response body as JSON
          result = JSON.parse(response_body)
          ACCEPT: result === true (boolean)
          ACCEPT: result === "true" (string — some Supabase clients return strings)
IF result === false OR result === "false":
  HARD STOP: "is_premium() returned false for active subscriber.
              Check the RPC logic in 002_create_rpcs.sql:
              - Does it check status = 'active'?
              - Does it match email case-insensitively? (use lower())
              - Is current_period_end > now() in the WHERE clause?
              - Did the test row timestamps have Z suffix (UTC)? See Step 5.3 note."
IF result is string "true" (not boolean true):
  DISPLAY : "ℹ️  RPC returned string 'true' — this is acceptable, treated as PASS"
OUTPUT  : "✓ is_premium() returns true for active subscriber (via anon key)"
```

### STEP 5.6 — Verify get_subscription() returns correct data

```
ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/rest/v1/rpc/get_subscription
          Header: apikey: [PAYCRAFT_SUPABASE_ANON_KEY]
          Header: Content-Type: application/json
          Body: {"user_email": "e2e-verify@paycraft.io"}

VERIFY  : HTTP 200
VERIFY  : Response contains plan = "[PAYCRAFT_PLAN_1_ID]"
VERIFY  : Response contains status = "active"
IF WRONG DATA:
  HARD STOP: "get_subscription() returned unexpected data: [response].
              Expected plan=[PAYCRAFT_PLAN_1_ID], status=active."
OUTPUT  : "✓ get_subscription() returns correct subscription data"
```

### STEP 5.7 — Clean up test row

```
ACTION  : DELETE https://[PAYCRAFT_SUPABASE_URL]/rest/v1/subscriptions
          ?email=eq.e2e-verify@paycraft.io
          &provider_subscription_id=eq.sub_paycraft_e2e_verify
          Header: apikey: [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]
          Header: Authorization: Bearer [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY]

VERIFY  : HTTP 204 (no content — deleted)
VERIFY  : GET subscriptions?email=eq.e2e-verify@paycraft.io → empty array
IF ROW STILL EXISTS:
  HARD STOP: "Test row not deleted. Delete manually:
              DELETE FROM subscriptions WHERE email = 'e2e-verify@paycraft.io';"
OUTPUT  : "✓ Test data cleaned up"
```

### STEP 5.8 — Verify all payment links are present and valid

```
READ    : PAYCRAFT_PLAN_COUNT from .env
IF PAYCRAFT_PLAN_COUNT is empty OR = "0":
  HARD STOP: "PAYCRAFT_PLAN_COUNT not set in .env.
              Run /paycraft-adopt and select [F] Fix specific phase → Phase 1 to configure plans."

READ    : PAYCRAFT_PROVIDER from .env
READ    : PAYCRAFT_MODE from .env (default to "test" if absent)

FOR EACH PLAN i = 1..PLAN_COUNT:
  READ    : PAYCRAFT_PLAN_[i]_ID (e.g. "monthly")
  PLAN_ID_UPPER = PAYCRAFT_PLAN_[i]_ID uppercased  (e.g. "MONTHLY")

  DETERMINE link_key based on PROVIDER and MODE:
    IF stripe AND mode = "test":   link_key = PAYCRAFT_STRIPE_TEST_LINK_[PLAN_ID_UPPER]
    IF stripe AND mode = "live":   link_key = PAYCRAFT_STRIPE_LIVE_LINK_[PLAN_ID_UPPER]
    IF razorpay:                   link_key = PAYCRAFT_RAZORPAY_LINK_[PLAN_ID_UPPER]

  READ    : link value from .env
  VERIFY  : non-empty
  IF EMPTY:
    HARD STOP: "[link_key] is not set in .env.
                Re-run Phase 3 (mode=[mode]) to create payment links."

  VERIFY URL FORMAT:
    IF stripe + test:
      EXPECT: starts with "https://buy.stripe.com/test/" OR "https://buy.stripe.com/"
      IF starts with "https://buy.stripe.com/" AND NOT "/test/":
        DISPLAY: "⚠️  WARNING: [link_key] appears to be a LIVE Stripe link.
                   Phase 3A (test mode) may not have completed.
                   In test mode, use PAYCRAFT_STRIPE_TEST_LINK_* keys."
    IF stripe + live:
      EXPECT: starts with "https://buy.stripe.com/"
      IF starts with "https://buy.stripe.com/test/":
        DISPLAY: "⚠️  WARNING: [link_key] is a TEST link but PAYCRAFT_MODE=live.
                   Update PAYCRAFT_STRIPE_LIVE_LINK_* with live payment link URLs."
    IF razorpay:
      EXPECT: starts with "https://rzp.io" or "https://pages.razorpay.com"

  OUTPUT  : "  ✓ [link_key]: [url]"

OUTPUT : "✓ All [N] payment links present (mode=[PAYCRAFT_MODE])"
```

### STEP 5.8B — KMP integration audit (no platform-specific billing code)

```
⚠️ HARD RULE — PayCraft is KMP. Any billing logic in platform-specific code is a defect.

SEARCH in [target_app_path]:
  1. Grep for "subscriptionManager" OR "refreshStatus" in androidMain/**/*.kt OR iosMain/**/*.kt
  2. Grep for "PayCraft" in MainActivity.kt, AppDelegate.kt, Application.kt (androidMain/iosMain)
     EXCEPTION: PayCraftPlatform.init() in androidMain or iosMain is ALLOWED (it's required).
  3. Grep for "LifecycleEventEffect" OR "ON_RESUME" — must be in commonMain, not platform-specific

FOR EACH match found outside allowed locations:
  DISPLAY: "⚠️ KMP VIOLATION: [file] — PayCraft billing code in platform-specific source"
           "  Found: [matching line]"
           "  Fix  : Move to commonMain (LifecycleEventEffect for resume refresh)"

IF any violations found:
  HARD STOP: "KMP violations detected. Fix before proceeding."
             "PayCraft is a KMP library — ALL billing calls must be in commonMain."
             "The only allowed platform-specific call: PayCraftPlatform.init() in androidMain/iosMain."
ELSE:
  OUTPUT: "✓ KMP audit: no platform-specific billing code detected"

VERIFY: Does the paywall/settings commonMain file contain LifecycleEventEffect(ON_RESUME)?
IF NOT FOUND:
  DISPLAY: "⚠️  Missing: LifecycleEventEffect(Lifecycle.Event.ON_RESUME) in paywall screen"
           "  Without this, premium status won't refresh after Stripe checkout."
           "  Add to your paywall Composable (commonMain):"
           "  LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { subscriptionManager.refreshStatus() }"
  NOTE: This is a WARNING (not hard stop) — app will still work but status refresh requires app restart.
ELSE:
  OUTPUT: "✓ ON_RESUME subscription refresh present in commonMain"
```

### STEP 5.9 — Client app build check (if Phase 4 ran)

```
READ    : Was Phase 4 completed? (check if app path was provided)

IF Phase 4 was MANUAL (user skipped):
  DISPLAY: "Phase 4 was skipped (manual integration). Build check skipped."
  OUTPUT  : "⏭ Build check skipped"
  CONTINUE

IF Phase 4 ran against an app:
  DISPLAY: "Running Gradle compile check..."

  DETECT OS:
    IF Windows (OS contains "Windows" OR PATHEXT env var exists):
      GRADLE_CMD = "gradlew.bat"
    ELSE:
      GRADLE_CMD = "./gradlew"
      VERIFY: [app_path]/gradlew exists AND is executable
      IF NOT EXECUTABLE: run chmod +x [app_path]/gradlew

  ACTION  : cd [app_path] && [GRADLE_CMD] :shared:compileKotlinMetadata --no-daemon 2>&1
            (--no-daemon prevents stale JVM state from prior failed builds)
            (metadata compile only — fast, no full build needed)
  TIMEOUT : 120 seconds
  VERIFY  : Exit code 0 AND output does not contain "error:"
  IF EXIT CODE != 0 OR "error:" IN OUTPUT:
    DISPLAY ERROR OUTPUT (last 30 lines)
    HARD STOP: "App does not compile with PayCraft integration.
                Fix the errors above before proceeding.
                Common issues:
                  - Missing import: import com.mobilebytelabs.paycraft.*
                  - PayCraft version not synced: ./gradlew --refresh-dependencies
                  - Koin version conflict: check libs.versions.toml"
  OUTPUT  : "✓ App compiles with PayCraft dependency"
```

---

## STEP 5.10 — Write deployment state to adopting project

```
NOTE: .paycraft/ is created inside the ADOPTING PROJECT (TARGET_APP_PATH),
      not inside the PayCraft library directory.
      This keeps each project's deployment context self-contained.

DEPLOYMENT_DIR = {target_app_path}/.paycraft/
  (if Phase 4 was skipped: use {paycraft_root}/.paycraft/ as fallback)

CREATE DIR: {DEPLOYMENT_DIR} (if not exists)
CREATE DIR: {DEPLOYMENT_DIR}supabase/migrations/ (if not exists)
CREATE DIR: {DEPLOYMENT_DIR}supabase/functions/ (if not exists)
CREATE DIR: {DEPLOYMENT_DIR}backups/ (if not exists)

--- 5.10A: Backup Supabase resources ---

ACTION: Copy {paycraft_root}/server/migrations/*.sql
        → {DEPLOYMENT_DIR}supabase/migrations/
        (keeps a local copy of the exact SQL that was deployed)

ACTION: Copy {paycraft_root}/server/functions/{provider}-webhook/
        → {DEPLOYMENT_DIR}supabase/functions/{provider}-webhook/
        (keeps a copy of the exact webhook Edge Function that was deployed)

OUTPUT: "✓ Supabase resources backed up → .paycraft/supabase/"

--- 5.10B: Write config.json (setup answers) ---

COLLECT Phase 4 choices:
  paycraft_root   = PAYCRAFT_ROOT (from .env)
  provider        = PAYCRAFT_PROVIDER
  key_storage     = key_storage_choice (local.properties | Config.kt | inline | BuildConfig)
  billing_ui_file = full path to SettingsScreen/paywall host file
  init_file       = full path to app init file (where PayCraft.configure runs)
  plan_count      = PAYCRAFT_PLAN_COUNT
  plans           = [{id, name, price, interval, popular} for each PAYCRAFT_PLAN_[i]_*]

WRITE: {DEPLOYMENT_DIR}config.json
Content:
{
  "setup_at": "[ISO8601 UTC timestamp]",
  "paycraft_root": "[paycraft_root]",
  "app": {
    "path": "[target_app_path]",
    "init_file": "[relative path from app root]",
    "billing_ui_file": "[relative path from app root]",
    "key_storage": "[local.properties|Config.kt|inline|BuildConfig]"
  },
  "provider": "[stripe|razorpay]",
  "plan_count": [N],
  "plans": [
    { "id": "[id]", "name": "[name]", "price": "[price]", "interval": "[interval]", "popular": [bool] }
  ]
}

OUTPUT: "✓ Setup config saved → .paycraft/config.json"

--- 5.10C: Write deployment.json (resource IDs, no secrets) ---

READ    : PAYCRAFT_MODE from .env (default "test")

COLLECT from .env and current session:
  supabase_ref    = PAYCRAFT_SUPABASE_PROJECT_REF
  supabase_url    = PAYCRAFT_SUPABASE_URL
  mode            = PAYCRAFT_MODE
  webhook_url     = {supabase_url}/functions/v1/{provider}-webhook

FOR STRIPE:
  IF mode = "test":
    product_id    = PAYCRAFT_STRIPE_TEST_PRODUCT_ID
    price_ids     = {plan_id: PAYCRAFT_STRIPE_TEST_PRICE_[PLAN_ID]} for each plan
    payment_links = {plan_id: PAYCRAFT_STRIPE_TEST_LINK_[PLAN_ID]} for each plan
    portal_url    = PAYCRAFT_STRIPE_TEST_PORTAL_URL
    livemode      = false
  IF mode = "live":
    product_id    = PAYCRAFT_STRIPE_LIVE_PRODUCT_ID
    price_ids     = {plan_id: PAYCRAFT_STRIPE_LIVE_PRICE_[PLAN_ID]} for each plan
    payment_links = {plan_id: PAYCRAFT_STRIPE_LIVE_LINK_[PLAN_ID]} for each plan
    portal_url    = PAYCRAFT_STRIPE_LIVE_PORTAL_URL
    livemode      = true
  account_id      = from mcp__stripe__get_stripe_account_info → acct_...

WRITE: {DEPLOYMENT_DIR}deployment.json
Content:
{
  "deployed_at": "[ISO8601 UTC timestamp]",
  "supabase": {
    "project_ref": "[supabase_ref]",
    "url": "[supabase_url]",
    "migrations_applied": ["001_create_subscriptions", "002_create_rpcs"],
    "webhook_function": "[provider]-webhook",
    "last_deployed": "[ISO8601 UTC timestamp]"
  },
  "provider": {
    "name": "[stripe|razorpay]",
    "mode": "[PAYCRAFT_MODE]",
    "livemode": [true if mode=live, false if mode=test],
    "account_id": "[acct_xxx or rzp_test_xxx prefix]",
    "product_id": "[prod_xxx or null for razorpay]",
    "prices": { "[plan_id]": "[price_id]" },
    "payment_links": { "[plan_id]": "[url]" },
    "portal_url": "[url or null]",
    "webhook_url": "[supabase_url]/functions/v1/[provider]-webhook",
    "last_deployed": "[ISO8601 UTC timestamp]"
  },
  "migration_history": []
}

VERIFY: Both JSON files written and valid
OUTPUT: "✓ Deployment state saved → .paycraft/deployment.json"
        "  (deployment state — used for account migration planning)"

--- 5.10D: Add .paycraft/ to app .gitignore ---

READ: {target_app_path}/.gitignore (if exists)

IF .gitignore does NOT exist:
  CREATE: {target_app_path}/.gitignore (empty file)

CHECK .gitignore for each entry — only append what's missing:

  IF does not contain ".env":
    APPEND: "# PayCraft secrets — NEVER commit"
    APPEND: ".env"
    APPEND: ".env.local"
    APPEND: ".env.*.local"

  IF does not contain ".paycraft/backups/":
    APPEND: "# PayCraft deployment context"
    APPEND: "# deployment.json and config.json are safe to commit (no secrets)"
    APPEND: "# backups/ contain .env copies — NEVER commit"
    APPEND: ".paycraft/backups/"
    APPEND: ".paycraft/supabase/functions/*/secrets"

OUTPUT: "✓ .gitignore updated:"
        "  - .env excluded (PayCraft credentials)"
        "  - .paycraft/backups/ excluded (timestamped .env copies)"
        "  Safe to commit: .paycraft/config.json + .paycraft/deployment.json + .paycraft/supabase/"
```

---

## Phase 5B — Sandbox E2E Test (S9 — 7-step proof of billing)

```
PREREQUISITE: Phase 1–4 all complete AND PAYCRAFT_STRIPE_TEST_LINK_{plan} present.

DISPLAY:
  "SANDBOX E2E TEST — 7 steps to prove billing works end-to-end"
  "No real money. Uses test card. Verifies webhook → DB → RPC flow."
  ""

--- Step 5B.1: Open payment link ---
  READ: PAYCRAFT_STRIPE_TEST_LINK_{PAYCRAFT_PLAN_1_ID} from .env
  DISPLAY:
    "Step 1: Open this payment link in your browser:"
    "  {payment_link}"
    ""
    "Press Enter when the Stripe checkout page has loaded."
  WAIT: user presses Enter

--- Step 5B.2: Fill checkout with test card ---
  DISPLAY:
    "Step 2: Fill the Stripe checkout form:"
    "  Card number : 4242 4242 4242 4242"
    "  Expiry      : any future date (e.g. 12/28)"
    "  CVC         : any 3 digits (e.g. 123)"
    "  Email       : use a test email you'll remember (e.g. test@example.com)"
    "  Name        : Test User (or anything)"
    ""
    "  → Click 'Subscribe' / 'Pay'"
    ""
    "Press Enter after you clicked Subscribe."
  WAIT: user presses Enter

--- Step 5B.3: Confirm checkout completed ---
  DISPLAY:
    "Step 3: Did Stripe show a success page or redirect to your app?"
    "  [Y] Yes — payment accepted   [N] No — still on checkout"
  WAIT: user picks
  IF [N]:
    DISPLAY: "Check that:
               1. Card number is exactly: 4242 4242 4242 4242 (spaces are OK)
               2. Expiry is a FUTURE date
               3. Stripe is in TEST mode (URL shows dashboard.stripe.com/test/)
               Try again. Press Enter when payment is accepted."
    WAIT: user presses Enter

--- Step 5B.4: Wait for webhook (30 second timeout) ---
  DISPLAY: "Step 4: Waiting for Stripe webhook to reach Supabase..."
  TEST_EMAIL = the email used in Step 5B.2

  POLL: every 3 seconds for up to 30 seconds:
    SELECT status FROM subscriptions WHERE email = '{TEST_EMAIL}' LIMIT 1
    Auth: PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY
    IF row exists AND status = 'active': webhook received → BREAK
    DISPLAY progress: "  ⏳ {elapsed}s / 30s — waiting..."

  IF 30s timeout without row:
    DISPLAY:
      "Webhook not received after 30 seconds."
      ""
      "DIAGNOSIS:"
      "  1. Check webhook endpoint in Stripe:"
      "     → https://dashboard.stripe.com/test/webhooks"
      "     → Is your endpoint URL set to:"
      "       https://{PAYCRAFT_SUPABASE_PROJECT_REF}.supabase.co/functions/v1/stripe-webhook"
      "     → Are these events listed?"
      "       ✓ customer.subscription.created"
      "       ✓ customer.subscription.updated"
      "       ✓ customer.subscription.deleted"
      "       ✓ invoice.paid"
      ""
      "  2. Check Edge Function logs for errors:"
      "     supabase functions logs stripe-webhook --project-ref {PAYCRAFT_SUPABASE_PROJECT_REF}"
      ""
      "  3. Verify PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET matches the signing secret"
      "     shown on the webhook endpoint page (whsec_...)"
      ""
      "[R] Retry (webhook may be delayed)   [F] Show fix steps   [Q] Quit"
    WAIT: user picks
    IF [R]: resume polling for 30 more seconds
    IF [F]: show full webhook setup guide from Phase 2
    IF [Q]: abort test

--- Step 5B.5: Verify subscription row in DB ---
  SELECT * FROM subscriptions WHERE email = '{TEST_EMAIL}' LIMIT 1
  Auth: PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY
  VERIFY: row exists AND status = 'active'
  CAPTURE: subscription_id, plan, provider
  IF FAIL: HARD STOP — "Subscription row not found. Webhook may have failed.
                         Check: supabase functions logs stripe-webhook --project-ref {ref}"
  DISPLAY: "  ✓ Step 5: Subscription row exists — status=active, plan={plan}"

--- Step 5B.6: Verify is_premium() returns true ---
  SELECT is_premium('{TEST_EMAIL}')
  Auth: PAYCRAFT_SUPABASE_ANON_KEY
  VERIFY: returns true
  IF FAIL: HARD STOP — "is_premium() returned false for active subscriber.
                         Check RPC definition — should query subscriptions WHERE email={email} AND status='active'."
  DISPLAY: "  ✓ Step 6: is_premium() = true for test user"

--- Step 5B.7: Clean up test data ---
  DELETE FROM subscriptions WHERE email = '{TEST_EMAIL}'
  Auth: PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY
  VERIFY: DELETE response HTTP 200 or 204
  DISPLAY: "  ✓ Step 7: Test data cleaned up"

--- Write test results ---
  WRITE: {TARGET_APP_PATH}/.paycraft/test_results/sandbox_test.json
  Content:
    {
      "timestamp": "{ISO timestamp}",
      "paycraft_version": "{version}",
      "result": "PASS",
      "steps_passed": 7,
      "test_email": "{TEST_EMAIL}",
      "payment_link_used": "{payment_link}",
      "webhook_delay_seconds": {actual_seconds},
      "subscription_id": "{subscription_id}"
    }

DISPLAY:
  "╔══ SANDBOX E2E TEST PASSED ══════════════════════════════════════════╗"
  "║  ✓ Step 1: Payment link opened                                      ║"
  "║  ✓ Step 2: Test card filled                                         ║"
  "║  ✓ Step 3: Stripe checkout accepted payment                         ║"
  "║  ✓ Step 4: Webhook received in {n}s                                 ║"
  "║  ✓ Step 5: Subscription row active in DB                            ║"
  "║  ✓ Step 6: is_premium() returns true                                ║"
  "║  ✓ Step 7: Test data cleaned up                                     ║"
  "║                                                                      ║"
  "║  Billing is working end-to-end.                                     ║"
  "║  Results saved: .paycraft/test_results/sandbox_test.json            ║"
  "╚══════════════════════════════════════════════════════════════════════╝"
```

## Phase 5C — Real Device Sandbox Test

```
PREREQUISITE: Phase 5B PASS and a physical/emulator Android or iOS device connected.

LOGCAT FILTER (run in a separate terminal before installing):
  adb logcat -s "PayCraft:D" "*:S"
  (all PayCraft events — configure, checkout, refreshStatus, is_premium — flow through here)

--- Step 5C.1: Confirm IS_TEST_MODE = true ---

READ: {configure_file} from memory.json (e.g. core/network/.../NetworkModule.kt)
SCAN: Find the StripeProvider(...) call
CHECK: isTestMode parameter OR IS_TEST_MODE flag

IF isTestMode = false OR IS_TEST_MODE = false:
  DISPLAY:
    "⚠️  IS_TEST_MODE is currently FALSE (live mode)."
    "   Switch to true for sandbox testing, then rebuild."
    "   File: {configure_file}"
    "   Change: isTestMode = false  →  isTestMode = true"
  WAIT: user confirms they've changed it
ELSE:
  OUTPUT: "✓ IS_TEST_MODE = true — sandbox mode confirmed"

--- Step 5C.2: Build + install on device ---

DISPLAY:
  "Building and installing debug APK..."
  "  ./gradlew :cmp-android:installDebug"
  ""
  "Press Enter when app is installed and launched on device."
WAIT: user presses Enter

--- Step 5C.3: Check configure() log ---

DISPLAY:
  "Expected logcat output after app launch:"
  ""
  "  D PayCraft: ══ PayCraft.configure() ═════════════════════════════"
  "  D PayCraft:   Provider     = stripe | TEST mode (sandbox — use 4242 test cards)"
  "  D PayCraft:   Supabase URL = https://{ref}.supabase.co"
  "  D PayCraft:   Plans (4): monthly, quarterly, semiannual, yearly*"
  "  D PayCraft:   Test links   = ✓ 4/4 configured"
  "  D PayCraft:   Live links   = ⚠ 0/4 — run /paycraft-adopt → Phase 3 live to create"
  "  D PayCraft:   Filter: adb logcat -s \"PayCraft:D\" \"*:S\""
  "  D PayCraft: ════════════════════════════════════════════════════"
  ""
  "If you see  ⚠ Live links = 0/4  — that's expected for now (live keys not yet set)."
  "If you see  ⚠ Test links = 0/4  — re-run Phase 3 (test) before proceeding."
  ""
  "[Y] I see configure() logs   [N] No log output"

IF [N]:
  DISPLAY:
    "PayCraftLogger is enabled by default."
    "Check that PayCraft.configure() is actually being called at app startup."
    "Verify: {configure_file} is called from your app's init path."

--- Step 5C.4: Navigate to paywall ---

DISPLAY:
  "In the app: navigate to Settings → Premium / Paywall screen."
  ""
  "Expected logcat:"
  "  D PayCraft: refreshStatus() — no stored email → Free (UI should prompt sign-in)"
  "    OR"
  "  D PayCraft: refreshStatus() → checking status for: {email}"
  "  D PayCraft: RPC is_premium(email={email})"
  "  D PayCraft:   ↳ is_premium result: false"
  "  D PayCraft: isPremium=false for {email} — no active subscription found"
  ""
  "[Y] I see the paywall   [N] Paywall not showing"

--- Step 5C.5: Tap a plan + complete sandbox checkout ---

DISPLAY:
  "Tap any plan (e.g. Yearly) → 'Get Premium' button."
  ""
  "Expected logcat immediately after tap:"
  "  D PayCraft: checkout — plan=yearly, mode=TEST"
  "  D PayCraft:   Opening: https://buy.stripe.com/test_..."
  ""
  "In the browser/WebView that opens:"
  "  Card number : 4242 4242 4242 4242"
  "  Expiry      : any future date (e.g. 12/28)"
  "  CVC         : any 3 digits (e.g. 123)"
  "  Email       : use any test email"
  "  → Click Subscribe"
  ""
  "After payment succeeds, return to the app."
  "[Y] Payment accepted + back in app"

--- Step 5C.6: Verify ON_RESUME refresh + premium status ---

DISPLAY:
  "After returning to app, ON_RESUME fires automatically."
  ""
  "Expected logcat:"
  "  D PayCraft: refreshStatus() → checking status for: {email}"
  "  D PayCraft: RPC is_premium(email={email})"
  "  D PayCraft:   ↳ is_premium result: true"
  "  D PayCraft: ✓ isPremium=true — plan=yearly, provider=stripe, expires=..., willRenew=true"
  ""
  "Expected UI: paywall shows 'ACTIVE ✓' banner, plan listed with green checkmark."
  ""
  "[Y] Logs show isPremium=true AND UI shows active  ✓  → SANDBOX DEVICE TEST PASSED"
  "[N] Still showing free — check webhook:"
  "    supabase functions logs stripe-webhook --project-ref {PAYCRAFT_SUPABASE_PROJECT_REF}"

--- Write Phase 5C result ---

IF PASS:
  WRITE: {TARGET_APP_PATH}/.paycraft/test_results/sandbox_device_test.json
  Content:
    {
      "test_type": "sandbox_device",
      "run_at": "{ISO timestamp}",
      "result": "PASS",
      "is_test_mode": true,
      "device_log_confirmed": true
    }
  OUTPUT: "✓ Phase 5C PASS — sandbox device test verified via logcat"
```

---

## Phase 5D — Real Device Live Test

```
PREREQUISITE: Live Stripe keys set in .env.

--- Step 5D.0: Live keys gate ---

READ from .env:
  PAYCRAFT_STRIPE_LIVE_SECRET_KEY  → must start with sk_live_
  PAYCRAFT_STRIPE_LIVE_LINK_*      → all plan links must be non-empty
  PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET → must start with whsec_
  PAYCRAFT_STRIPE_LIVE_PORTAL_URL  → recommended (allows subscription management)

DISPLAY live keys status:
  "┌─ Live Keys Status ──────────────────────────────────────────────┐"
  "│ PAYCRAFT_STRIPE_LIVE_SECRET_KEY    {✓ sk_live_... | ⬜ MISSING} │"
  "│ PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY  {✓ url | ⬜ MISSING}         │"
  "│ PAYCRAFT_STRIPE_LIVE_LINK_QUARTERLY {✓ url | ⬜ MISSING}        │"
  "│ PAYCRAFT_STRIPE_LIVE_LINK_SEMIANNUAL {✓ url | ⬜ MISSING}       │"
  "│ PAYCRAFT_STRIPE_LINK_YEARLY        {✓ url | ⬜ MISSING}         │"
  "│ PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET {✓ whsec_... | ⬜ MISSING}  │"
  "└─────────────────────────────────────────────────────────────────┘"

IF any MISSING:
  DISPLAY:
    "Live keys are not yet configured. Here is how to get each one:"
    ""
    "── PAYCRAFT_STRIPE_LIVE_SECRET_KEY ──────────────────────────────"
    "  1. Open https://dashboard.stripe.com/apikeys"
    "  2. Toggle TEST mode OFF (top-left — turns orange → 'Live')"
    "  3. Under 'Secret key', click 'Reveal live key'"
    "  4. Copy sk_live_... → add to .env: PAYCRAFT_STRIPE_LIVE_SECRET_KEY=sk_live_..."
    ""
    "── PAYCRAFT_STRIPE_LIVE_LINK_* (payment links) ──────────────────"
    "  These are created automatically by Phase 3 (live mode)."
    "  To create:"
    "  1. Set PAYCRAFT_MODE=live in .env"
    "  2. Run: /paycraft-adopt → [F] Fix specific phase → Phase 3"
    "  3. Phase 3 will create live products, prices, and payment links"
    "  4. Links are saved as PAYCRAFT_STRIPE_LIVE_LINK_{PLAN} in .env"
    ""
    "── PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET ──────────────────────────"
    "  Created automatically during Phase 3 (live) at Step 3B.5."
    "  To check manually:"
    "  1. Open https://dashboard.stripe.com/webhooks"
    "  2. Click your live endpoint → 'Signing secret' → Reveal"
    "  3. Copy whsec_... → add to .env: PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET=whsec_..."
    ""
    "[S] Skip live test for now (set up test mode only)   [C] Continue after adding keys"
  WAIT: user picks
  IF [S]: EXIT Phase 5D — display "Live test skipped. Run /paycraft-adopt when ready."

--- Step 5D.1: Flip to live mode + rebuild ---

DISPLAY:
  "Switching to LIVE mode:"
  ""
  "  In {configure_file}:"
  "  Change: isTestMode = true  →  isTestMode = false"
  "    OR"
  "  Change: IS_TEST_MODE = true  →  IS_TEST_MODE = false"
  ""
  "Then rebuild: ./gradlew :cmp-android:installDebug"
  ""
  "Press Enter when installed and launched."
WAIT: user presses Enter

--- Step 5D.2: Confirm LIVE mode in logcat ---

DISPLAY:
  "Expected logcat:"
  "  D PayCraft:   Provider     = stripe | LIVE mode (production — real cards)"
  "  D PayCraft:   Test links   = ✓ 4/4 configured"
  "  D PayCraft:   Live links   = ✓ 4/4 configured"
  ""
  "[Y] Seeing LIVE mode in logs   [N] Still showing TEST"

IF [N]:
  DISPLAY: "IS_TEST_MODE was not changed. Check {configure_file} and rebuild."
  WAIT: user confirms

--- Step 5D.3: Open paywall + tap a plan ---

DISPLAY:
  "Navigate to paywall → tap any plan → 'Get Premium'."
  ""
  "Expected logcat:"
  "  D PayCraft: checkout — plan={plan}, mode=LIVE"
  "  D PayCraft:   Opening: https://buy.stripe.com/{live-link}"
  ""
  "⚠️  REAL MONEY: This opens a live Stripe checkout. Use a real card."
  "    The charge will be real. Use a low-cost plan for testing (monthly = ₹100)."
  ""
  "[Y] Live checkout opened in browser"

--- Step 5D.4: Complete payment + verify ---

DISPLAY:
  "Complete payment with a real card. After returning to app:"
  ""
  "Expected logcat:"
  "  D PayCraft: refreshStatus() → checking status for: {email}"
  "  D PayCraft: RPC is_premium(email={email})"
  "  D PayCraft:   ↳ is_premium result: true"
  "  D PayCraft: ✓ isPremium=true — plan={plan}, provider=stripe, expires=..., willRenew=true"
  ""
  "Expected UI: 'ACTIVE ✓' banner with plan name."
  ""
  "[Y] isPremium=true in logs + ACTIVE shown in UI  →  LIVE DEVICE TEST PASSED"
  "[N] Still free — check live webhook at https://dashboard.stripe.com/webhooks"
  "    Verify endpoint points to: https://{ref}.supabase.co/functions/v1/stripe-webhook"

--- Write Phase 5D result + flip back to test mode ---

IF PASS:
  WRITE: {TARGET_APP_PATH}/.paycraft/test_results/live_device_test.json
  Content:
    {
      "test_type": "live_device",
      "run_at": "{ISO timestamp}",
      "result": "PASS",
      "is_test_mode": false,
      "device_log_confirmed": true
    }
  OUTPUT: "✓ Phase 5D PASS — live device test verified via logcat"

DISPLAY:
  "──────────────────────────────────────────────────────────────────"
  "⚠️  Remember to flip IS_TEST_MODE back to true before committing!"
  "   Production release: keep false. Development: keep true."
  "──────────────────────────────────────────────────────────────────"

UPDATE memory.json → phases_verified: add "live_device"
```

---

## Phase 5 Memory Write (M3e — atomic)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
TMP_PATH    = {TARGET_APP_PATH}/.paycraft/memory.json.tmp

READ existing memory.json → merge
SET fields:
  phases_completed = add "verify" if not already present
  phases_verified  = add "supabase", "client" (if 5B passed: add "sandbox_e2e")
  last_run         = current ISO timestamp

WRITE: JSON to {TMP_PATH}
RENAME: {TMP_PATH} → {MEMORY_PATH}
OUTPUT: "✓ Phase 5 state saved → .paycraft/memory.json"
```

## Phase 5 Final Summary

```
╔══ PayCraft Setup Complete ══════════════════════════════════════════════╗
║                                                                          ║
║  SUPABASE                                                                ║
║  ✓ Project: [name] ([ref])                                              ║
║  ✓ Table: subscriptions (12 cols, UNIQUE email, RLS enabled)            ║
║  ✓ RPCs: is_premium() ✓  get_subscription() ✓                          ║
║  ✓ Webhook: [provider]-webhook (no JWT check, returns 400 unsigned)     ║
║                                                                          ║
║  [PROVIDER] (TEST MODE)                                                  ║
║  ✓ Product: [product_id]                                                 ║
║  ✓ Plans ([N]):                                                          ║
║    [for each: plan_name — plan_id — payment_link]                        ║
║  ✓ Webhook signing secret: configured                                    ║
║  ✓ Customer portal: [portal_url]                                         ║
║                                                                          ║
║  CLIENT APP                                                              ║
║  ✓ Dependency: io.github.mobilebytelabs:paycraft:[version]              ║
║  ✓ PayCraft.configure() in [configure_file]                              ║
║  ✓ PayCraftModule in Koin — {koin_module_file}:{koin_module_line}       ║
║  ✓ PayCraftBanner in {billing_card_file}:{billing_card_line}            ║
║  ✓ Build: compiles clean                                                 ║
║                                                                          ║
║  E2E VERIFICATION                                                        ║
║  ✓ DB write: service_role INSERT succeeded                               ║
║  ✓ is_premium(): returns true for active subscriber                      ║
║  ✓ get_subscription(): returns correct plan+status                      ║
║  ✓ Test data cleaned up                                                  ║
║                                                                          ║
║  SANDBOX E2E TEST                                                        ║
║  ✓ Payment link opened + test card charged                               ║
║  ✓ Webhook received in {n}s → subscription row active                   ║
║  ✓ is_premium() = true confirmed                                         ║
║  ✓ Results: .paycraft/test_results/sandbox_test.json                    ║
║                                                                          ║
║  ✓ memory.json updated — all phases remembered                           ║
║                                                                          ║
║  ══════════════════════════════════════════════════════════════════      ║
║  STATUS: FULLY OPERATIONAL — TEST MODE                                   ║
║  ══════════════════════════════════════════════════════════════════      ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Live Mode Upgrade Checklist

Print this after the summary:

```
╔══ GOING LIVE — Checklist ════════════════════════════════════════════╗
║                                                                       ║
║  When you're ready to accept real payments:                           ║
║                                                                       ║
║  Step 1: Add LIVE Stripe key to .env                                  ║
║    • Open: https://dashboard.stripe.com/apikeys (Test mode OFF)      ║
║    • Copy sk_live_... key                                             ║
║    • Add to .env: PAYCRAFT_STRIPE_LIVE_SECRET_KEY=sk_live_...        ║
║    • (PAYCRAFT_STRIPE_TEST_SECRET_KEY stays — needed for test mode)  ║
║                                                                       ║
║  Step 2: Run Phase 3B (live mode setup)                               ║
║    • Set PAYCRAFT_MODE=live in .env                                   ║
║    • Run: /paycraft-adopt → [F] Fix specific phase → Phase 3 (auto-detects live mode)             ║
║    • Creates LIVE products, prices, payment links                     ║
║    • Fills PAYCRAFT_STRIPE_LIVE_LINK_*, PAYCRAFT_STRIPE_LIVE_*       ║
║                                                                       ║
║  Step 3: LIVE webhook is created in Phase 3B (Step 3B.5)             ║
║    • Signing secret saved to PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET     ║
║    • Also set on Supabase: supabase secrets set STRIPE_WEBHOOK_SECRET ║
║                                                                       ║
║  Step 4: Update initPayCraft() in your app                            ║
║    • SUPABASE_URL and SUPABASE_ANON_KEY are the same (no change)     ║
║    • Swap payment link URLs → PAYCRAFT_STRIPE_LIVE_LINK_* values     ║
║    • Swap portal URL → PAYCRAFT_STRIPE_LIVE_PORTAL_URL value         ║
║                                                                       ║
║  Step 5: Test with a real payment before launch                       ║
║    • Use a real card (not test card 4242 4242...)                     ║
║    • Verify is_premium() returns true after payment                   ║
║    • Verify subscription appears in Stripe Dashboard → Subscriptions  ║
║                                                                       ║
║  Reverting to test mode:                                              ║
║    • Set PAYCRAFT_MODE=test in .env — no other changes needed        ║
║    • Both test and live keys always present in .env                   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
```
