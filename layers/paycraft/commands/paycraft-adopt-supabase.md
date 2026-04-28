# paycraft-adopt-supabase — Phase 2: Supabase Setup

> **PHASE 2 of 5** — Applies migrations, creates RPCs, deploys webhook, device binding tables + RPCs, Brevo SMTP, OTP hook, verifies every step.
> 15 steps. Every step has an inline verification. HARD STOP on any failure.
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
NOTE: Deployed via Supabase Management API — no CLI required.

READ    : PAYCRAFT_PROVIDER from .env → function_slug = "[provider]-webhook"
          (e.g. stripe-webhook or razorpay-webhook)

PRE-CHECK — function already deployed?
  GET https://api.supabase.com/v1/projects/[ref]/functions
  Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
  FIND: function with slug = "[provider]-webhook" AND status = "ACTIVE"
  IF FOUND: OUTPUT "ℹ [provider]-webhook already ACTIVE — skipping deploy (idempotent)"
            SKIP to STEP 2.9

ACTION  : Read function source:
          {paycraft_root}/server/functions/[provider]-webhook/index.ts

ACTION  : POST https://api.supabase.com/v1/projects/[ref]/functions
          Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          Content-Type: application/json
          Body: {
            "slug": "[provider]-webhook",
            "name": "[provider]-webhook",
            "body": "[full contents of index.ts as a JSON string]",
            "verify_jwt": false
          }
VERIFY  : HTTP 201
IF NOT 201:
  HARD STOP: "[provider]-webhook deploy failed (HTTP [status]).
              Error: [response body]
              Fix: verify PAYCRAFT_SUPABASE_ACCESS_TOKEN is valid (sbp_...)"

VERIFY ACTIVE:
  GET https://api.supabase.com/v1/projects/[ref]/functions
  FIND: slug = "[provider]-webhook" AND status = "ACTIVE"
  IF NOT ACTIVE:
    HARD STOP: "[provider]-webhook deployed but status is [status].
                Check logs in Supabase dashboard."

OUTPUT  : "✓ [provider]-webhook deployed via Management API (verify_jwt=false)"
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
              Re-deploy via Step 2.8 (Management API with verify_jwt=false)."
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
NOTE: Secrets deployed via Supabase Management API — no CLI required.

READ    : PAYCRAFT_PROVIDER from .env

[IF STRIPE]
  BUILD secrets payload from .env values:
  secrets = []
  IF PAYCRAFT_STRIPE_TEST_SECRET_KEY non-empty:
    secrets += { "name": "STRIPE_TEST_SECRET_KEY",     "value": "[PAYCRAFT_STRIPE_TEST_SECRET_KEY]" }
  IF PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET non-empty:
    secrets += { "name": "STRIPE_TEST_WEBHOOK_SECRET", "value": "[PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET]" }
  IF PAYCRAFT_STRIPE_LIVE_SECRET_KEY non-empty:
    secrets += { "name": "STRIPE_LIVE_SECRET_KEY",     "value": "[PAYCRAFT_STRIPE_LIVE_SECRET_KEY]" }
  IF PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET non-empty:
    secrets += { "name": "STRIPE_LIVE_WEBHOOK_SECRET", "value": "[PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET]" }

  IF secrets is empty: HARD STOP — "No Stripe keys found in .env. Run Phase 1 first."

  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/secrets
            Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
            Content-Type: application/json
            Body: [secrets array]
  VERIFY  : HTTP 201

  VERIFY deployed:
    GET https://api.supabase.com/v1/projects/[ref]/secrets
    FIND: STRIPE_TEST_SECRET_KEY present (if TEST key in .env)
    FIND: STRIPE_LIVE_SECRET_KEY present (if LIVE key in .env)
    IF NEITHER: HARD STOP — "Stripe secrets not found after deploy."

  OUTPUT  : "✓ Stripe secrets deployed via Management API:"
            "    STRIPE_TEST_SECRET_KEY      — [set / not set]"
            "    STRIPE_TEST_WEBHOOK_SECRET  — [set / not set]"
            "    STRIPE_LIVE_SECRET_KEY      — [set / not set]"
            "    STRIPE_LIVE_WEBHOOK_SECRET  — [set / not set]"

[IF RAZORPAY]
  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/secrets
            Body: [{ "name": "RAZORPAY_KEY_SECRET", "value": "[PAYCRAFT_RAZORPAY_KEY_SECRET]" }]
  VERIFY  : HTTP 201 AND secret appears in GET /secrets
  IF NOT FOUND: HARD STOP — "RAZORPAY_KEY_SECRET not deployed."
  OUTPUT  : "✓ RAZORPAY_KEY_SECRET deployed via Management API"
```

### STEP 2.10 — Apply migration 005_registered_devices.sql (device binding table)

```
--- Idempotency check first ---
CHECK: SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name='registered_devices'

IF registered_devices EXISTS:
  OUTPUT: "ℹ registered_devices table already exists — skipping (idempotent)"
  SKIP to Step 2.11

IF NOT EXISTS:
  ACTION  : Read file: {paycraft_root}/server/migrations/005_registered_devices.sql
  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/database/query
            Header: Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
            Body: {"query": "[SQL content from 005_registered_devices.sql]"}
  VERIFY  : HTTP 200 AND no "error" in response
  IF ERROR:
    HARD STOP: "Migration 005 failed.
                Error: [exact error from response]
                Manual fix: copy SQL to Supabase SQL editor at
                https://supabase.com/dashboard/project/{ref}/sql"

VERIFY SCHEMA:
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'registered_devices'
  EXPECT columns: id, email, device_token, platform, device_name, mode,
                  is_active, last_seen_at, registered_at, revoked_at, revoked_by
  IF ANY MISSING:
    HARD STOP: "registered_devices table missing columns: [list].
                Drop and re-apply: DROP TABLE IF EXISTS registered_devices; then retry."

OUTPUT  : "✓ Migration 005 applied (registered_devices table)"
```

### STEP 2.11 — Apply migration 006_server_token_rpcs.sql (device RPCs)

```
--- Idempotency check: verify RPCs exist ---
CHECK: SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'public'
         AND routine_name IN ('register_device', 'check_premium_with_device',
                               'transfer_to_device', 'revoke_device', 'get_active_devices')

IF all 5 RPCs exist:
  OUTPUT: "ℹ Device RPCs already exist — skipping (idempotent)"
  SKIP to Step 2.12

IF any MISSING:
  ACTION  : Read file: {paycraft_root}/server/migrations/006_server_token_rpcs.sql
  ACTION  : POST database/query with SQL content from 006_server_token_rpcs.sql
  VERIFY  : No "error" in response

  VERIFY RPCs:
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN ('register_device', 'check_premium_with_device',
                           'transfer_to_device', 'revoke_device', 'get_active_devices')
  EXPECT: 5 rows returned
  IF < 5:
    HARD STOP: "Device RPCs not fully created. Missing: [list].
                Check 006_server_token_rpcs.sql syntax and re-apply."

OUTPUT  : "✓ Migration 006 applied:"
         "    register_device() RPC"
         "    check_premium_with_device() RPC"
         "    transfer_to_device() RPC"
         "    revoke_device() RPC"
         "    get_active_devices() RPC"
```

### STEP 2.11B — Apply migration 008_fix_register_device_dedup.sql (register_device dedup fix)

```
NOTE: This migration fixes a critical bug in register_device() where LIMIT 1 without
      ORDER BY could pick a stale/wrong active row, causing spurious conflicts and
      accumulating duplicate active registrations on each app reinstall.
      Uses CREATE OR REPLACE FUNCTION — safe to re-run (always idempotent).

--- Idempotency check: does the current function already have the dedup fix? ---
CHECK: SELECT prosrc FROM pg_proc
       JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
       WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'

IF FOUND AND prosrc CONTAINS 'ORDER BY registered_at DESC':
  OUTPUT: "ℹ register_device() already has dedup fix (ORDER BY registered_at DESC) — skipping (idempotent)"
  SKIP to STEP 2.12

IF NOT FOUND OR prosrc does NOT contain 'ORDER BY registered_at DESC':
  ACTION  : Read file: {paycraft_root}/server/migrations/008_fix_register_device_dedup.sql
  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/database/query
            Header: Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
            Body: {"query": "[SQL content from 008_fix_register_device_dedup.sql]"}
  VERIFY  : HTTP 200 AND no "error" in response
  IF ERROR:
    HARD STOP: "Migration 008 failed.
                Error: [exact error from response]
                This migration fixes the register_device() dedup bug — required for
                correct device binding behavior.
                Manual fix: copy SQL to Supabase SQL editor at
                https://supabase.com/dashboard/project/{ref}/sql"

  VERIFY applied:
    SELECT prosrc FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'
    CHECK: prosrc CONTAINS 'ORDER BY registered_at DESC'
    IF NOT: HARD STOP "Migration 008 applied but function body missing ORDER BY fix."

OUTPUT  : "✓ Migration 008 applied (register_device() dedup fix: ORDER BY + duplicate cleanup)"
```

### STEP 2.11C — Apply migration 009_device_id.sql (hardware device identity)

```
NOTE: This migration adds a hardware-unique device_id column to registered_devices and
      updates register_device() to use it for same-device detection.
      Security fix: replaces insecure platform+device_name check (model labels are not unique).
      Backward compat: p_device_id DEFAULT NULL — old 4-arg clients continue working.
      Uses CREATE OR REPLACE FUNCTION — safe to re-run (idempotent).

--- Idempotency check: does device_id column already exist? ---
CHECK: SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'registered_devices'
         AND column_name  = 'device_id'

IF FOUND:
  OUTPUT: "ℹ registered_devices.device_id column already exists — skipping column add (idempotent)"
  SKIP column ALTER (still apply CREATE OR REPLACE FUNCTION to ensure latest RPC logic)

--- Idempotency check: does the RPC already accept p_device_id? ---
CHECK: SELECT prosrc FROM pg_proc
       JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
       WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'

IF FOUND AND prosrc CONTAINS 'p_device_id':
  OUTPUT: "ℹ register_device() already accepts p_device_id — skipping (idempotent)"
  SKIP to STEP 2.12

IF NOT:
  ACTION  : Read file: {paycraft_root}/server/migrations/009_device_id.sql
  ACTION  : POST https://api.supabase.com/v1/projects/[ref]/database/query
            Header: Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
            Body: {"query": "[SQL content from 009_device_id.sql]"}
  VERIFY  : HTTP 200 AND no "error" in response
  IF ERROR:
    HARD STOP: "Migration 009 failed.
                Error: [exact error from response]
                This migration adds hardware device_id for secure same-device detection.
                Manual fix: copy SQL to Supabase SQL editor at
                https://supabase.com/dashboard/project/{ref}/sql"

  VERIFY applied:
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'registered_devices'
      AND column_name  = 'device_id'
    IF NOT FOUND: HARD STOP "Migration 009 applied but device_id column not found."

    SELECT prosrc FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'
    CHECK: prosrc CONTAINS 'p_device_id'
    IF NOT: HARD STOP "Migration 009 applied but register_device() missing p_device_id param."

OUTPUT  : "✓ Migration 009 applied (device_id column + hardware-unique same-device detection)"
```

### STEP 2.12 — Apply migration 007_otp_send_gate.sql (OTP rate limiting)

```
--- Idempotency check ---
CHECK: SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name='otp_send_log'

IF otp_send_log EXISTS:
  OUTPUT: "ℹ otp_send_log table already exists — skipping (idempotent)"
  SKIP to STEP 2.13

IF NOT EXISTS:
  ACTION  : Read file: {paycraft_root}/server/migrations/007_otp_send_gate.sql
  ACTION  : POST database/query with SQL content from 007_otp_send_gate.sql
  VERIFY  : No "error" in response

  VERIFY otp_send_log table:
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='otp_send_log'
    EXPECT: 1
    IF 0: HARD STOP: "otp_send_log table not created."

  VERIFY check_otp_gate() RPC:
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'check_otp_gate'
    EXPECT: 1 row
    IF 0: HARD STOP: "check_otp_gate() RPC not created."

OUTPUT  : "✓ Migration 007 applied (otp_send_log table + check_otp_gate() RPC)"
```

### STEP 2.13 — Deploy otp-send-hook Edge Function

```
NOTE: Deployed via Supabase Management API — no CLI required.
      Fires after every OTP email dispatched by Supabase Auth.
      Increments daily counter in otp_send_log (monitors Brevo 300/day free limit).

PRE-CHECK — already deployed?
  GET https://api.supabase.com/v1/projects/[ref]/functions
  Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
  FIND: slug = "otp-send-hook" AND status = "ACTIVE"
  IF FOUND: OUTPUT "ℹ otp-send-hook already ACTIVE — skipping deploy (idempotent)"
            SKIP to STEP 2.14

ACTION  : Read function source:
          {paycraft_root}/server/functions/otp-send-hook/index.ts

ACTION  : POST https://api.supabase.com/v1/projects/[ref]/functions
          Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          Content-Type: application/json
          Body: {
            "slug": "otp-send-hook",
            "name": "otp-send-hook",
            "body": "[full contents of index.ts as a JSON string]",
            "verify_jwt": false
          }
VERIFY  : HTTP 201
IF NOT 201:
  HARD STOP: "otp-send-hook deploy failed (HTTP [status]).
              Error: [response body]"

VERIFY ACTIVE:
  GET https://api.supabase.com/v1/projects/[ref]/functions
  FIND: slug = "otp-send-hook" AND status = "ACTIVE"
  IF NOT ACTIVE: HARD STOP "otp-send-hook deployed but not ACTIVE."

OUTPUT  : "✓ otp-send-hook deployed via Management API (ACTIVE)"
```

### STEP 2.14 — Configure Brevo SMTP + deploy secret (fully automated)

```
NOTE: Brevo's free tier gives 300 emails/day — sufficient for OTP sends.
      All configuration is done via API — no browser steps required.

━━━ STEP 2.14A — Get Brevo API key ━━━

CHECK .env for BREVO_API_KEY:
  IF present and non-empty: use it → skip asking
  IF missing:
    DISPLAY:
      "Brevo API key needed for OTP email delivery (free — 300 emails/day)."
      ""
      "Get it in 2 steps:"
      "  1. Sign up at https://www.brevo.com (free, no credit card)"
      "  2. Go to: top-right menu → API Keys → Create API key → copy"
      ""
      "Enter your Brevo API key:"
    WAIT: user pastes key
    WRITE to .env: BREVO_API_KEY={key}

━━━ STEP 2.14B — Resolve Brevo account email via API ━━━

ACTION  : GET https://api.brevo.com/v3/account
          Header: api-key: {BREVO_API_KEY}
VERIFY  : HTTP 200
IF HTTP 401:
  HARD STOP: "Brevo API key invalid (HTTP 401).
              Check the key at: https://app.brevo.com/settings/keys/api
              Then re-enter it."
IF HTTP != 200:
  HARD STOP: "Brevo API unreachable (HTTP [status]).
              Check internet connection and try again."

EXTRACT: email = response.email  (Brevo account login email)
OUTPUT  : "✓ Brevo account verified: {email}"

━━━ STEP 2.14C — Push BREVO_API_KEY to Supabase Edge Function secrets ━━━

PRE-CHECK: GET /v1/projects/[ref]/secrets → BREVO_API_KEY already present?
  IF PRESENT: OUTPUT "ℹ BREVO_API_KEY already in Supabase secrets (idempotent)"
              SKIP to 2.14D

ACTION  : POST https://api.supabase.com/v1/projects/[ref]/secrets
          Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          Content-Type: application/json
          Body: [{ "name": "BREVO_API_KEY", "value": "{BREVO_API_KEY}" }]
VERIFY  : HTTP 201
VERIFY  : GET /secrets → BREVO_API_KEY present
IF NOT: HARD STOP "BREVO_API_KEY not found in Supabase secrets after push."

OUTPUT  : "✓ BREVO_API_KEY deployed to Supabase Edge Function secrets"

━━━ STEP 2.14D — Configure Brevo SMTP in Supabase Auth via Management API ━━━

PRE-CHECK: GET /v1/projects/[ref]/config/auth
  IF smtp_host = "smtp-relay.brevo.com" AND smtp_user non-empty:
    OUTPUT "ℹ Brevo SMTP already configured (idempotent)"
    SKIP to STEP 2.15

ACTION  : PATCH https://api.supabase.com/v1/projects/[ref]/config/auth
          Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          Content-Type: application/json
          Body: {
            "smtp_admin_email": "{email from 2.14B}",
            "smtp_host":        "smtp-relay.brevo.com",
            "smtp_port":        587,
            "smtp_user":        "{email from 2.14B}",
            "smtp_pass":        "{BREVO_API_KEY}",
            "smtp_sender_name": "PayCraft",
            "smtp_max_frequency": 60
          }
VERIFY  : HTTP 200
IF NOT 200:
  HARD STOP: "Brevo SMTP config failed (HTTP [status]).
              Error: [response body]
              Check PAYCRAFT_SUPABASE_ACCESS_TOKEN is valid."

VERIFY applied:
  GET /v1/projects/[ref]/config/auth → smtp_host = "smtp-relay.brevo.com"
  IF NOT: HARD STOP "SMTP config not saved."

WRITE to .env: PAYCRAFT_BREVO_SMTP_USER={email}
MARK: smtp_configured = true
WRITE to memory.json: smtp_status = "COMPLETE"

OUTPUT  : "✓ Brevo SMTP configured in Supabase Auth via API"
          "  Host:  smtp-relay.brevo.com:587"
          "  Login: {email}"
```

### STEP 2.15 — Wire otp-send-hook as Supabase Auth Hook (fully automated)

```
NOTE: Auth Hook wiring via Supabase Management API — no browser steps required.

HOOK_URL = "https://[PAYCRAFT_SUPABASE_PROJECT_REF].supabase.co/functions/v1/otp-send-hook"

PRE-CHECK: GET /v1/projects/[ref]/config/auth
  IF hook_send_email_enabled = true AND hook_send_email_uri = {HOOK_URL}:
    OUTPUT "ℹ Send Email Auth Hook already wired (idempotent)"
    MARK: otp_hook_wired = true
    WRITE to memory.json: otp_hook_status = "COMPLETE"
    SKIP to Phase 2 Post-Phase Verification

ACTION  : PATCH https://api.supabase.com/v1/projects/[ref]/config/auth
          Authorization: Bearer [PAYCRAFT_SUPABASE_ACCESS_TOKEN]
          Content-Type: application/json
          Body: {
            "hook_send_email_enabled": true,
            "hook_send_email_uri": "{HOOK_URL}"
          }
VERIFY  : HTTP 200
IF NOT 200:
  DISPLAY: "Auth Hook PATCH failed (HTTP [status])."
           "This may mean the project is on Supabase Free plan — Auth Hooks require Pro."
           ""
           "[U] Upgrade to Pro at: https://supabase.com/dashboard/project/[ref]/settings/billing"
           "    Then press Enter to retry."
           "[D] Defer — mark as INCOMPLETE (⚠ OTP counter won't update, 300/day limit unmonitored)"
  WAIT: user picks
  IF [D]:
    WRITE to memory.json: otp_hook_status = "INCOMPLETE"
    DISPLAY: "⚠️  Auth Hook deferred — INCOMPLETE in memory.json. Resolve before going live."
    CONTINUE
  IF [U]: wait → retry PATCH → IF still fails: HARD STOP

VERIFY wired:
  GET /v1/projects/[ref]/config/auth
  VERIFY: hook_send_email_enabled = true AND hook_send_email_uri = {HOOK_URL}
  IF NOT: HARD STOP "Auth Hook not saved after PATCH."

MARK: otp_hook_wired = true
WRITE to memory.json: otp_hook_status = "COMPLETE"
OUTPUT  : "✓ otp-send-hook wired as Auth Hook (Send Email) via Management API"
          "  URI: {HOOK_URL}"
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
  IF NOT FOUND: HARD STOP — "Edge Function not found. Re-run Step 2.8 to deploy via Management API."
  IF status != ACTIVE: HARD STOP — "Edge Function status is [{status}].
                                      Fix: check logs:
                                      supabase functions logs {provider}-webhook --project-ref {ref}"

CHECK 5: registered_devices table exists (device binding — PayCraft ≥ 1.3.0)
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='registered_devices'
  EXPECT: count = 1
  IF FAIL: HARD STOP — "registered_devices table not found. Re-run Step 2.10."

CHECK 6: register_device() RPC exists
  SELECT COUNT(*) FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='register_device'
  EXPECT: count = 1
  IF FAIL: HARD STOP — "register_device() RPC not found. Re-run Step 2.11."

CHECK 7: check_premium_with_device() RPC exists
  SELECT COUNT(*) FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='check_premium_with_device'
  EXPECT: count = 1
  IF FAIL: HARD STOP — "check_premium_with_device() RPC not found. Re-run Step 2.11."

CHECK 7B: register_device() has dedup fix (migration 008)
  SELECT prosrc FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'
  EXPECT: prosrc CONTAINS 'ORDER BY registered_at DESC'
  IF FAIL: HARD STOP — "register_device() is missing the dedup fix. Re-run Step 2.11B."

CHECK 7C: registered_devices has device_id column and register_device() accepts p_device_id (migration 009)
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'registered_devices'
    AND column_name  = 'device_id'
  EXPECT: 1 row returned
  IF FAIL: HARD STOP — "device_id column not found in registered_devices. Re-run Step 2.11C."

  SELECT prosrc FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
  WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'register_device'
  EXPECT: prosrc CONTAINS 'p_device_id'
  IF FAIL: HARD STOP — "register_device() is missing p_device_id param. Re-run Step 2.11C."

CHECK 8: otp_send_log table exists
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_name='otp_send_log'
  EXPECT: count = 1
  IF FAIL: HARD STOP — "otp_send_log table not found. Re-run Step 2.12."

CHECK 9: otp-send-hook Edge Function status
  GET https://api.supabase.com/v1/projects/{ref}/functions
  FIND: function with slug "otp-send-hook"
  EXPECT: status = "ACTIVE"
  IF NOT FOUND: HARD STOP — "otp-send-hook not found. Re-run Step 2.13."

OUTPUT:
  ✓ subscriptions table: EXISTS
  ✓ is_premium() RPC: CALLABLE
  ✓ get_subscription() RPC: CALLABLE
  ✓ {provider}-webhook: ACTIVE
  ✓ registered_devices table: EXISTS
  ✓ register_device() RPC: EXISTS (dedup fix: ORDER BY registered_at DESC, device_id: supported)
  ✓ registered_devices.device_id: column EXISTS
  ✓ check_premium_with_device() RPC: EXISTS
  ✓ otp_send_log table: EXISTS
  ✓ otp-send-hook: ACTIVE
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
║                                                                          ║
║  DEVICE BINDING (PayCraft ≥ 1.3.0)                                      ║
║  ✓ registered_devices table — EXISTS (device_id column: present)         ║
║  ✓ register_device() RPC — EXISTS (dedup fix + device_id support)       ║
║  ✓ check_premium_with_device() RPC — EXISTS                             ║
║  ✓ transfer_to_device() RPC — EXISTS                                    ║
║  ✓ otp_send_log table — EXISTS                                          ║
║  ✓ otp-send-hook Edge Function — ACTIVE                                 ║
║  [smtp_configured]: Brevo SMTP — {✓ CONFIGURED | ⚠ SKIPPED}           ║
║  [otp_hook_wired]: Auth Hook — {✓ WIRED | ⚠ SKIPPED}                  ║
║                                                                          ║
║  ✓ memory.json updated                                                   ║
║                                                                          ║
║  Ready to proceed to Phase 3: Provider Setup?                           ║
║  [Y] Continue   [Q] Quit                                                 ║
╚══════════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding.
