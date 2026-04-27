# /paycraft-adopt-production — Production Readiness Check

> Loaded by `/paycraft-adopt` when user selects **[P] Production ready check**.
> Runs every gate in sequence. ALL must pass before the app ships with live billing.
> Writes `.paycraft/production_ready.json` — referenced by future `/paycraft-adopt` runs.

---

## Overview

This phase does NOT run setup or fix anything. It audits the current state against
every production requirement and issues a signed `production_ready.json` result.

If any gate fails → HARD STOP with exact fix instructions. Re-run after fixing.

---

## STEP PR.1 — Environment: All required keys present

```
READ: {ENV_PATH}

For each key below, check: set and non-empty? Value format correct?

TEST MODE KEYS (required for sandbox):
  [ ] PAYCRAFT_SUPABASE_URL          — starts with https://
  [ ] PAYCRAFT_SUPABASE_ANON_KEY     — set (any non-empty value)
  [ ] PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY — set
  [ ] PAYCRAFT_SUPABASE_PROJECT_REF  — 20-char alphanumeric
  [ ] PAYCRAFT_PROVIDER              — "stripe" or "razorpay"
  [ ] PAYCRAFT_STRIPE_TEST_SECRET_KEY — starts with sk_test_
  [ ] PAYCRAFT_STRIPE_WEBHOOK_SECRET — starts with whsec_
  [ ] At least one PAYCRAFT_STRIPE_LINK_* — non-empty URL

LIVE MODE KEYS (required for production):
  [ ] PAYCRAFT_STRIPE_LIVE_SECRET_KEY — starts with sk_live_
  [ ] PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET — starts with whsec_
  [ ] PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY  — non-empty URL (or equivalent plan)
  [ ] PAYCRAFT_APP_REDIRECT_URL       — contains "://"

IF any key missing or malformed:
  DISPLAY:
    "✗ GATE PR.1 FAILED — Missing or malformed keys:"
    "  [list each failing key with expected format]"
    ""
    "Fix: Run /paycraft-adopt → [D] Keys guide for exact steps."
    "     Run /paycraft-adopt → [F] Fix phase → Phase 1 to re-collect keys."
  HARD STOP.

OUTPUT: "✓ PR.1 PASS — All required keys present and correctly formatted"
```

---

## STEP PR.2 — Supabase: Schema + RPCs + webhook deployed

```
QUERY Supabase (using PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY):

[ ] subscriptions table exists
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='subscriptions'
    EXPECT: 1

[ ] is_premium() RPC exists
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_name='is_premium' AND routine_schema='public'
    EXPECT: 1

[ ] get_subscription() RPC exists
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_name='get_subscription' AND routine_schema='public'
    EXPECT: 1

[ ] stripe-webhook Edge Function ACTIVE
    GET https://api.supabase.com/v1/projects/{ref}/functions
    Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
    FIND: function with slug = "stripe-webhook" AND status = "ACTIVE"

[ ] STRIPE_WEBHOOK_SECRET secret is set in Edge Function environment
    GET https://api.supabase.com/v1/projects/{ref}/secrets
    Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
    FIND: secret named "STRIPE_WEBHOOK_SECRET"

IF any check fails:
  DISPLAY failing checks + fix:
    "Fix: Run /paycraft-adopt → [F] Fix phase → Phase 2 (Supabase)"
  HARD STOP.

OUTPUT: "✓ PR.2 PASS — Supabase: table ✓, is_premium ✓, get_subscription ✓, webhook ACTIVE ✓"
```

---

## STEP PR.3 — Client integration: All wiring present in commonMain

```
SCAN {target_app_path}:

[ ] PayCraft dependency in libs.versions.toml
    Glob **/libs.versions.toml → grep "paycraft"
    VERIFY: version is pinned (not "+" or "SNAPSHOT")

[ ] PayCraft.configure() call exists
    Grep {target_app_path}/**/*.kt for "PayCraft.configure"
    VERIFY: in commonMain (not androidMain/iosMain)
    VERIFY: supabase(...) + provider(...) + plans(...) all present in configure block

[ ] PayCraftModule in Koin
    Grep {target_app_path}/**/*.kt for "PayCraftModule"
    VERIFY: present in includes(...) of root KoinModules

[ ] PayCraftBanner in UI
    Grep {target_app_path}/**/commonMain/**/*.kt for "PayCraftBanner"
    VERIFY: at least one occurrence

[ ] LifecycleEventEffect(ON_RESUME) refresh
    Grep {target_app_path}/**/commonMain/**/*.kt for "LifecycleEventEffect"
    Grep {target_app_path}/**/commonMain/**/*.kt for "refreshStatus"
    VERIFY: both present (ON_RESUME triggers refreshStatus)

[ ] ZERO platform-specific billing calls
    Grep {target_app_path}/**/androidMain/**/*.kt for "PayCraft\|BillingManager\|refreshStatus"
    Grep {target_app_path}/**/iosMain/**/*.kt for "PayCraft\|BillingManager\|refreshStatus"
    EXPECT: 0 matches (PayCraftPlatform.init() is the only allowed exception)

IF any check fails:
  DISPLAY failing checks + fix:
    "Fix: Run /paycraft-adopt → [F] Fix phase → Phase 4 (Client)"
  HARD STOP.

OUTPUT: "✓ PR.3 PASS — Client integration: dependency ✓, configure ✓, Koin ✓, banner ✓, lifecycle ✓, KMP-first ✓"
```

---

## STEP PR.4 — Sandbox test: Phase 5B result verified

```
READ: {target_app_path}/.paycraft/test_results/sandbox_test.json

IF file missing:
  HARD STOP:
    "✗ PR.4 FAILED — No sandbox test result found."
    "Fix: Run /paycraft-adopt → [B] Test sandbox first."

CHECK:
  [ ] result = "PASS"
  [ ] webhook_received = true
  [ ] is_premium_api = true
  [ ] plan_id_correct = true
  [ ] tested_at is present (ISO8601)

IF result != "PASS" or any check fails:
  DISPLAY:
    "✗ PR.4 FAILED — Sandbox test did not pass."
    "Last result: [result]"
    "Fix: Run /paycraft-adopt → [B] Test sandbox and resolve all failures."
  HARD STOP.

OUTPUT: "✓ PR.4 PASS — Sandbox test passed on [tested_at] for email=[email_used] plan=[plan_tested]"
```

---

## STEP PR.5 — Live test: Phase 5C result verified

```
READ: {target_app_path}/.paycraft/test_results/live_test.json

IF file missing:
  HARD STOP:
    "✗ PR.5 FAILED — No live test result found."
    "Fix: Run /paycraft-adopt → [C] Test live first."

CHECK:
  [ ] result = "PASS"
  [ ] webhook_received = true
  [ ] is_premium_api = true
  [ ] tested_at is present (ISO8601)

IF result != "PASS" or any check fails:
  DISPLAY:
    "✗ PR.5 FAILED — Live test did not pass."
    "Fix: Run /paycraft-adopt → [C] Test live and resolve all failures."
  HARD STOP.

OUTPUT: "✓ PR.5 PASS — Live test passed on [tested_at] for plan=[plan_tested]"
```

---

## STEP PR.6 — Live mode configuration: IS_TEST_MODE flag audit

```
GREP {configure_file} (from memory) OR Grep "IS_TEST_MODE" in {target_app_path}/**/*.kt

CHECK A: IS_TEST_MODE constant exists
  IF missing: "⚠️  IS_TEST_MODE not found in PayCraftConfig.kt — add it."

CHECK B: LIVE_PAYMENT_LINKS map is populated
  Grep {target_app_path}/**/*.kt for "LIVE_PAYMENT_LINKS\|livePaymentLinks"
  VERIFY: map contains at least one non-empty entry

CHECK C: IS_TEST_MODE default value for production
  NOTE: for production builds IS_TEST_MODE MUST be false.
  This check is advisory — the value may be true for dev builds.
  DISPLAY:
    "Advisory: IS_TEST_MODE is currently [true/false] in PayCraftConfig.kt."
    "For the app store release build, IS_TEST_MODE must be false."
    "[✓] Acknowledged"
  WAIT: [✓]

OUTPUT: "✓ PR.6 PASS — Live mode config: LIVE_PAYMENT_LINKS populated ✓, IS_TEST_MODE flag present ✓"
```

---

## STEP PR.7 — Live RPC smoke test (no writes)

```
Using live keys (sk_live_) and the test email from sandbox_test.json:

POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/is_premium
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[email from sandbox_test.json]"}

VERIFY: HTTP 200 (value may be true or false — just checking reachability)

POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/get_subscription
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[email from sandbox_test.json]"}

VERIFY: HTTP 200

IF either fails with non-200:
  DISPLAY:
    "✗ PR.7 FAILED — Supabase RPCs unreachable in live mode."
    "Error: [HTTP status + body]"
    "Fix: Check PAYCRAFT_SUPABASE_URL and PAYCRAFT_SUPABASE_ANON_KEY."
  HARD STOP.

OUTPUT: "✓ PR.7 PASS — Supabase RPCs reachable and returning valid responses"
```

---

## STEP PR.8 — Write production_ready.json

```
ALL_PASSED = PR.1 && PR.2 && PR.3 && PR.4 && PR.5 && PR.6 && PR.7

WRITE (atomic: .tmp → rename):
  {target_app_path}/.paycraft/production_ready.json

{
  "result": "PASS",
  "certified_at": "[ISO8601 UTC now]",
  "paycraft_version": "[library version from libs.versions.toml]",
  "app_path": "[target_app_path]",
  "env_path": "[ENV_PATH]",
  "gates": {
    "PR1_env_keys":          { "result": "PASS", "detail": "all keys present and formatted" },
    "PR2_supabase":          { "result": "PASS", "detail": "table + RPCs + webhook ACTIVE" },
    "PR3_client_integration":{ "result": "PASS", "detail": "dependency + configure + Koin + banner + lifecycle + KMP-first" },
    "PR4_sandbox_test":      { "result": "PASS", "tested_at": "[from sandbox_test.json]", "email": "[email_used]" },
    "PR5_live_test":         { "result": "PASS", "tested_at": "[from live_test.json]" },
    "PR6_live_config":       { "result": "PASS", "detail": "LIVE_PAYMENT_LINKS populated, IS_TEST_MODE present" },
    "PR7_rpc_smoke":         { "result": "PASS", "detail": "is_premium + get_subscription reachable" }
  },
  "supabase_project_ref": "[ref]",
  "stripe_live_links_count": [n],
  "notes": ""
}

UPDATE: {target_app_path}/.paycraft/memory.json
  → phases_verified: append "production_ready"
  → last_run: now

OUTPUT:
"╔══ PRODUCTION READY ════════════════════════════════════════════╗"
"║                                                                  ║"
"║  ✓ PR.1  All keys present + correctly formatted                ║"
"║  ✓ PR.2  Supabase: table + RPCs + webhook deployed             ║"
"║  ✓ PR.3  Client: dependency + configure + Koin + banner        ║"
"║           + lifecycle + KMP-first (zero platform billing)      ║"
"║  ✓ PR.4  Sandbox test PASSED ([sandbox tested_at])             ║"
"║  ✓ PR.5  Live test PASSED    ([live tested_at])                ║"
"║  ✓ PR.6  Live mode config ready (IS_TEST_MODE + live links)    ║"
"║  ✓ PR.7  Supabase RPCs reachable                               ║"
"║                                                                  ║"
"║  ✅ BILLING IS PRODUCTION READY                                  ║"
"║                                                                  ║"
"║  Certified: [ISO8601 UTC]                                       ║"
"║  Saved to : .paycraft/production_ready.json                     ║"
"║                                                                  ║"
"║  To re-verify later: /paycraft-adopt → [P] Production ready    ║"
"╚══════════════════════════════════════════════════════════════════╝"
```

---

## Re-verification behaviour

When `/paycraft-adopt` loads and `.paycraft/production_ready.json` exists:
- Show in matrix: `[✓] Production certified — [certified_at]`
- If `certified_at` is older than 30 days: show `[⚠ Certified [date] — consider re-running [P]]`
- If any PAYCRAFT_* key in .env changed since `certified_at`: show `[⚠ Env changed since certification — re-run [P]]`
