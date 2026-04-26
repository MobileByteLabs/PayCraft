# paycraft-adopt-supabase — Phase 2: Supabase Setup

> **PHASE 2 of 5** — Applies migrations, creates RPCs, deploys webhook, verifies every step.
> 9 steps. Every step has an inline verification. HARD STOP on any failure.
> No step may be skipped or reordered.

---

## Pre-flight Gate (S3 — verify before any work starts)

```
PRE-FLIGHT CHECK — Phase 2:

1. Read .env → validate keys present + format:
   PAYCRAFT_SUPABASE_PROJECT_REF   — non-empty, matches [a-z0-9]{20}
   PAYCRAFT_SUPABASE_URL           — matches https://{ref}.supabase.co
   PAYCRAFT_SUPABASE_ACCESS_TOKEN  — starts with "sbp_"
   PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY — starts with "eyJ", length > 100
   PAYCRAFT_PROVIDER               — "stripe" or "razorpay"

   IF ANY MISSING OR INVALID:
     HARD STOP — "Required credentials missing. Run /paycraft-adopt and select [A] Full setup to complete Phase 1 first."
     Show exact which key is missing/invalid.

2. Verify Supabase project reachable:
   HEAD {PAYCRAFT_SUPABASE_URL}/rest/v1/ → expect HTTP 200 or 401
   (401 = keys wrong but project reachable; 200 = fully connected)
   IF NETWORK ERROR / TIMEOUT:
     HARD STOP — "Cannot reach {PAYCRAFT_SUPABASE_URL}.
                  Check: 1) Internet connection  2) Project URL is correct
                  Verify at: https://supabase.com/dashboard/project/{ref}"

DISPLAY:
  ✓ Keys present and format valid
  ✓ Supabase project reachable
  → Proceeding with Phase 2...
```

---

## Phase 2 Steps

### STEP 2.1 — Verify Supabase project is reachable

```
ACTION  : GET https://api.supabase.com/v1/projects/[PAYCRAFT_SUPABASE_PROJECT_REF]
          Header: Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
VERIFY  : HTTP 200
VERIFY  : Response JSON contains "status": "ACTIVE_HEALTHY"
IF HTTP 401 :
  HARD STOP: "Access token rejected. Check PAYCRAFT_SUPABASE_ACCESS_TOKEN.
              Get a fresh token at: https://supabase.com/dashboard/account/tokens"
IF HTTP 404 :
  HARD STOP: "Project not found. Check PAYCRAFT_SUPABASE_PROJECT_REF.
              The ref is the 20-char string in your project URL."
IF status != ACTIVE_HEALTHY :
  HARD STOP: "Project status is [status]. Wait for project to become ACTIVE_HEALTHY."
OUTPUT  : "✓ Supabase project reachable: [project name] ([ref])"
```

### STEP 2.2 — Apply migration 001_create_subscriptions.sql (idempotent)

```
--- Idempotency check first (S5) ---
CHECK: SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name='subscriptions'
       Auth: PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY (anon key will fail on schema_information)

IF subscriptions table EXISTS:
  OUTPUT: "ℹ subscriptions table already exists — skipping migration (idempotent)"
  SKIP to Step 2.3 (verify schema)

IF NOT EXISTS:
  ACTION  : Read file: {paycraft_root}/server/migrations/001_create_subscriptions.sql
  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/database/query
            Header: Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
            Header: Content-Type: application/json
            Body: {"query": "[SQL content from 001_create_subscriptions.sql]"}
  VERIFY  : HTTP 200 AND response does not contain "error"
  IF ERROR IN RESPONSE:
    HARD STOP: "Migration 001 failed.
                Error: [exact error from response]
                Common fixes:
                  1. Verify PAYCRAFT_SUPABASE_ACCESS_TOKEN is valid (sbp_...)
                  2. Verify PAYCRAFT_SUPABASE_PROJECT_REF is correct (20 lowercase chars)
                  3. Check Supabase project is ACTIVE_HEALTHY at dashboard.supabase.com"
  OUTPUT  : "✓ Migration 001 applied (subscriptions table)"
```

### STEP 2.3 — Verify subscriptions table schema

```
ACTION  : POST database/query with:
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'subscriptions'
          ORDER BY ordinal_position
VERIFY  : These columns exist (check column_name in result):
          id, email, provider, provider_customer_id, provider_subscription_id,
          plan, status, current_period_start, current_period_end,
          cancel_at_period_end, created_at, updated_at
VERIFY  : email column is_nullable = 'NO' (NOT NULL)
IF ANY COLUMN MISSING:
  HARD STOP: "subscriptions table missing columns: [list].
              Re-apply migration: DELETE FROM subscriptions; DROP TABLE subscriptions;
              Then re-run Step 2.2."
OUTPUT  : "✓ subscriptions schema verified (12 columns)"
```

### STEP 2.4 — Verify UNIQUE constraint on email

```
ACTION  : POST database/query with:
          SELECT constraint_name, constraint_type
          FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'subscriptions'
            AND constraint_type = 'UNIQUE'
VERIFY  : At least one row returned (a UNIQUE constraint exists)
IF NO ROWS:
  ACTION  : POST database/query with:
            ALTER TABLE public.subscriptions
            ADD CONSTRAINT subscriptions_email_unique UNIQUE (email);
  VERIFY  : Re-run the SELECT above → now returns 1 row
  IF STILL NO ROWS:
    HARD STOP: "Cannot create UNIQUE constraint on email.
                Check if email column has duplicate values:
                SELECT email, COUNT(*) FROM subscriptions GROUP BY email HAVING COUNT(*) > 1;"
  OUTPUT  : "✓ UNIQUE constraint added to email (was missing — fixed)"
ELSE:
  OUTPUT  : "✓ email UNIQUE constraint present"
```

### STEP 2.5 — Verify RLS is enabled

```
ACTION  : POST database/query with:
          SELECT relname, relrowsecurity
          FROM pg_class
          JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
          WHERE pg_namespace.nspname = 'public'
            AND relname = 'subscriptions'
VERIFY  : relrowsecurity = true
IF FALSE:
  ACTION  : POST database/query with:
            ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
  VERIFY  : Re-run SELECT → relrowsecurity = true
  IF STILL FALSE:
    HARD STOP: "Cannot enable RLS on subscriptions table."
  OUTPUT  : "✓ RLS enabled (was disabled — fixed)"
ELSE:
  OUTPUT  : "✓ RLS enabled on subscriptions"
```

### STEP 2.6 — Apply migration 002_create_rpcs.sql

```
ACTION  : Read file: {paycraft_root}/server/migrations/002_create_rpcs.sql
ACTION  : POST database/query with SQL content from 002_create_rpcs.sql
VERIFY  : No "error" in response

ACTION  : POST database/query with:
          SELECT routine_name FROM information_schema.routines
          WHERE routine_schema = 'public'
            AND routine_name IN ('is_premium', 'get_subscription')
VERIFY  : Both 'is_premium' AND 'get_subscription' appear in result (2 rows)
IF MISSING:
  HARD STOP: "RPCs not created. Missing: [list].
              Error from migration: [error from step above]
              Check 002_create_rpcs.sql syntax."
OUTPUT  : "✓ is_premium() RPC created"
         "✓ get_subscription() RPC created"
```

### STEP 2.7 — Test is_premium() RPC with anon key

```
ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/rest/v1/rpc/is_premium
          Header: apikey: [PAYCRAFT_SUPABASE_ANON_KEY]
          Header: Content-Type: application/json
          Body: {"user_email": "e2e-verify@paycraft.io"}
VERIFY  : HTTP 200
VERIFY  : Response body is exactly: false
IF HTTP 401:
  HARD STOP: "RPC call rejected with 401.
              Check PAYCRAFT_SUPABASE_ANON_KEY is the anon (public) key, not service_role key."
IF HTTP 404:
  HARD STOP: "is_premium RPC not found at REST endpoint.
              Check migration 002 applied correctly."
IF response is not false:
  HARD STOP: "is_premium() returned [response] instead of false for unknown email.
              Check RPC logic in 002_create_rpcs.sql."
OUTPUT  : "✓ is_premium() callable via anon key, returns false for unknown email (e2e-verify@paycraft.io)"
```

### STEP 2.8 — Deploy webhook Edge Function

```
PRE-CHECK: Run: supabase --version
VERIFY VERSION: Parse version number from output
  STRIP pre-release suffix before comparing: remove anything after the third numeric segment
    e.g. "1.50.0-beta" → "1.50.0", "1.50-rc1" → "1.50", "2.0.0" → "2.0.0"
  PASS if: major ≥ 2, OR (major = 1 AND minor ≥ 50)
  IF OUTDATED:
    HARD STOP: "Supabase CLI version [version] is too old (need ≥ 1.50.0).
                Update:
                  macOS:   brew upgrade supabase/tap/supabase
                  npm:     npm install -g supabase@latest
                  Linux:   curl -s https://raw.githubusercontent.com/supabase/cli/main/install.sh | bash
                Then re-run this step."

IF COMMAND NOT FOUND:
  USER ACTION GATE:
    "Install Supabase CLI first:"
    "  macOS:  brew install supabase/tap/supabase"
    "  Linux:  curl -s https://raw.githubusercontent.com/supabase/cli/main/install.sh | bash"
    "  npm:    npm install -g supabase"
    "After installing, run: supabase --version"
    "Press Enter when installed:"
  WAIT: user confirms
  VERIFY: supabase --version returns a version string
  IF STILL FAILS: HARD STOP — "Supabase CLI not found. Install it before continuing."

ACTION  : supabase login --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          (OR: SUPABASE_ACCESS_TOKEN=[token] in env)

READ    : PAYCRAFT_PROVIDER from .env → function name = [provider]-webhook
          (e.g. stripe-webhook or razorpay-webhook)

ACTION  : supabase functions deploy [provider]-webhook
            --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
            --no-verify-jwt
          (Run from {paycraft_root} — functions are in {paycraft_root}/server/functions/)
          NOTE: The functions use https://esm.sh/ imports directly — no --import-map needed.
          If supabase CLI looks for functions in supabase/functions/ by default and cannot
          find {paycraft_root}/server/functions/, copy the folder first:
            cp -r {paycraft_root}/server/functions/[provider]-webhook {paycraft_root}/supabase/functions/[provider]-webhook
          Then deploy from repo root.

VERIFY  : supabase functions list --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
          → [provider]-webhook appears in list with status = ACTIVE
IF NOT IN LIST:
  HARD STOP: "[provider]-webhook not in functions list after deploy.
              Check deploy output above for errors.
              Common fix: supabase login --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN]"
OUTPUT  : "✓ [provider]-webhook deployed (--no-verify-jwt)"
```

### STEP 2.9 — Test webhook endpoint is live (unsigned smoke test)

```
ACTION  : POST https://[PAYCRAFT_SUPABASE_URL]/functions/v1/[provider]-webhook
          Header: Content-Type: application/json
          Body: {}
          (No Authorization header — intentionally unsigned)
VERIFY  : HTTP response is 400 (Bad Request — expected: function is live but rejects unsigned)
          NOT 401 (means JWT verification is ON — --no-verify-jwt not applied)
          NOT 404 (means function not deployed)
          NOT 500 (means function crashed on startup)
IF 401:
  HARD STOP: "Webhook function requires JWT (got 401).
              Re-deploy with --no-verify-jwt:
              supabase functions deploy [provider]-webhook
                --project-ref [ref]
                --no-verify-jwt"
IF 404:
  HARD STOP: "Webhook function not found (got 404).
              Re-run Step 2.8."
IF 500:
  HARD STOP: "Webhook function crashed on start (got 500).
              Check function logs:
              supabase functions logs [provider]-webhook --project-ref [ref]"
OUTPUT  : "✓ Webhook live: https://[PAYCRAFT_SUPABASE_URL]/functions/v1/[provider]-webhook"
         "  Returns 400 for unsigned requests (correct — means JWT check is OFF)"
```

### STEP 2.9B — Set provider API key as Supabase function secret

```
AUTH CHECK: Verify Supabase CLI is authenticated before setting secrets:
  ACTION  : supabase projects list --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN] 2>&1
  VERIFY  : Exit code 0 (token valid, at least one project listed)
  IF FAILS (non-zero exit or "unauthorized"):
    ACTION  : supabase login --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
    VERIFY  : Exit code 0
    IF STILL FAILS:
      HARD STOP: "Supabase CLI authentication failed.
                  Token: [first 8 chars of PAYCRAFT_SUPABASE_ACCESS_TOKEN]...
                  Get a fresh token at: https://supabase.com/dashboard/account/tokens
                  Then run: supabase login --token [token]"

READ    : PAYCRAFT_PROVIDER from .env

[IF STRIPE]
  READ: PAYCRAFT_MODE from .env (default "test")
  KEY_TO_USE = PAYCRAFT_STRIPE_TEST_SECRET_KEY (if mode=test) OR PAYCRAFT_STRIPE_LIVE_SECRET_KEY (if mode=live)
  ACTION  : supabase secrets set STRIPE_SECRET_KEY=[KEY_TO_USE value]
              --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
  VERIFY  : supabase secrets list --project-ref [ref] | grep STRIPE_SECRET_KEY
  IF NOT FOUND: HARD STOP — "STRIPE_SECRET_KEY secret not set. Check supabase CLI auth."
  OUTPUT  : "✓ STRIPE_SECRET_KEY set as function secret"

[IF RAZORPAY]
  ACTION  : supabase secrets set RAZORPAY_KEY_SECRET=[PAYCRAFT_RAZORPAY_KEY_SECRET]
              --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
  VERIFY  : supabase secrets list --project-ref [ref] | grep RAZORPAY_KEY_SECRET
  IF NOT FOUND: HARD STOP — "RAZORPAY_KEY_SECRET secret not set."
  OUTPUT  : "✓ RAZORPAY_KEY_SECRET set as function secret"
```

---

## Phase 2 Post-Phase Verification (S4 — prove it worked)

```
Run these checks BEFORE declaring Phase 2 complete:

CHECK 1: subscriptions table exists
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='subscriptions'
  EXPECT: count = 1
  IF FAIL: HARD STOP — "subscriptions table not found after migration.
                         Fix: manually run 001_create_subscriptions.sql in Supabase SQL editor
                         at https://supabase.com/dashboard/project/{ref}/sql"

CHECK 2: is_premium() RPC callable
  SELECT is_premium()
  EXPECT: returns true or false (no error)
  IF FAIL: HARD STOP — "is_premium() RPC not found.
                         Fix: run the RPC migration SQL manually in Supabase SQL editor"

CHECK 3: get_subscription() RPC callable
  SELECT get_subscription()
  EXPECT: returns row or null (no error)
  IF FAIL: HARD STOP — "get_subscription() RPC not found.
                         Fix: run the RPC migration SQL manually"

CHECK 4: stripe-webhook (or razorpay-webhook) Edge Function status
  GET https://api.supabase.com/v1/projects/{ref}/functions
  Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
  FIND: function with slug "{provider}-webhook"
  EXPECT: status = "ACTIVE"
  IF NOT FOUND: HARD STOP — "Edge Function not found.
                              Fix: supabase functions deploy {provider}-webhook
                                   --project-ref {ref}
                                   --no-verify-jwt"
  IF status != ACTIVE: HARD STOP — "Edge Function status is [{status}].
                                      Fix: check logs:
                                      supabase functions logs {provider}-webhook --project-ref {ref}"

OUTPUT:
  ✓ subscriptions table: EXISTS
  ✓ is_premium() RPC: CALLABLE
  ✓ get_subscription() RPC: CALLABLE
  ✓ {provider}-webhook: ACTIVE
  → Phase 2 VERIFIED
```

## Phase 2 Memory Write (M3b — atomic)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
TMP_PATH    = {TARGET_APP_PATH}/.paycraft/memory.json.tmp

READ existing memory.json → merge
SET fields:
  supabase_project_ref = {PAYCRAFT_SUPABASE_PROJECT_REF}
  last_run             = current ISO timestamp
  phases_completed     = add "supabase" if not already present

WRITE: JSON to {TMP_PATH}
RENAME: {TMP_PATH} → {MEMORY_PATH}
OUTPUT: "✓ Phase 2 state saved → .paycraft/memory.json"
```

## Phase 2 Checkpoint

```
╔══ PHASE 2 COMPLETE — Supabase Setup ══════════════════════════════════╗
║                                                                          ║
║  ✓ Project reachable: [name] ([ref]) — ACTIVE_HEALTHY                  ║
║  ✓ subscriptions table — EXISTS (verified)                              ║
║  ✓ UNIQUE constraint on email, RLS enabled                              ║
║  ✓ is_premium() RPC — CALLABLE (verified)                               ║
║  ✓ get_subscription() RPC — CALLABLE (verified)                         ║
║  ✓ {provider}-webhook — ACTIVE (verified)                               ║
║  ✓ Provider API key set as function secret                               ║
║  ✓ memory.json updated                                                   ║
║                                                                          ║
║  Ready to proceed to Phase 3: Provider Setup?                           ║
║  [Y] Continue   [Q] Quit                                                 ║
╚══════════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding.
