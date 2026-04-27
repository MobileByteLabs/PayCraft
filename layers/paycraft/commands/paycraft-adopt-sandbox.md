# /paycraft-adopt-sandbox — Phase 5B: Sandbox E2E Test

> Loaded by `/paycraft-adopt` when user selects **[B] Test sandbox**.
> Tests the complete payment flow with Stripe test cards. No real money.
> Verifies: checkout → webhook → DB → is_premium() → device logs → app UI.

---

## Testing Architecture (RULE — display before every sandbox run)

```
╔══ How PayCraft Sandbox Testing Works ═══════════════════════════════╗
║                                                                       ║
║  REAL infrastructure. Fake money. Nothing is mocked.                 ║
║                                                                       ║
║  Stripe (test mode)           Supabase (PRODUCTION project)          ║
║  ─────────────────            ────────────────────────────           ║
║  sk_test_ key         ──┐     Same project ref used for live         ║
║  Test payment links   ──┤     Real Edge Function deployed            ║
║  4242 test card       ──┘     Real subscriptions table               ║
║           │                           │                               ║
║           │   Stripe fires webhook    │                               ║
║           └──────────────────────────▶ stripe-webhook Edge Fn        ║
║                                        writes subscription row        ║
║                                        is_premium() returns true      ║
║                                                                       ║
║  IS_TEST_MODE = true   → app uses test payment links                 ║
║  IS_TEST_MODE = false  → app uses live payment links (real money)    ║
║                                                                       ║
║  Supabase secrets for test mode:                                      ║
║    STRIPE_SECRET_KEY    = sk_test_...  (validates webhook signature)  ║
║    STRIPE_WEBHOOK_SECRET = whsec_...  (test webhook signing secret)   ║
║                                                                       ║
║  ⚠️  Supabase secrets MUST match the mode being tested.              ║
║     Mixing live secret key with test webhook = webhook verify fail.  ║
║                                                                       ║
║  VERIFY BEFORE EACH RUN:                                              ║
║    [ ] IS_TEST_MODE = true in PayCraftConfig.kt                      ║
║    [ ] Supabase STRIPE_SECRET_KEY = sk_test_... (not sk_live_)       ║
║    [ ] Supabase STRIPE_WEBHOOK_SECRET = test whsec_...               ║
║    [ ] App rebuilt + installed after any PayCraftConfig change        ║
╚═══════════════════════════════════════════════════════════════════════╝
```

---

## Prerequisites

Read .env → must be ✓:
- `PAYCRAFT_STRIPE_TEST_SECRET_KEY` starts with `sk_test_`
- `PAYCRAFT_STRIPE_WEBHOOK_SECRET` starts with `whsec_`
- At least one `PAYCRAFT_STRIPE_LINK_*` non-empty
- `PAYCRAFT_SUPABASE_URL` + `PAYCRAFT_SUPABASE_ANON_KEY` + `PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY` set

IF missing: "Run Phase 1–3 first." → STOP

---

## STEP 5B.1 — Display test credentials + payment links

```
DISPLAY:
╔══ Stripe Sandbox Test Card ══════════════════════════════════╗
║                                                               ║
║  Card Number : 4242 4242 4242 4242                           ║
║  Expiry      : Any future date  (e.g. 12/28)                 ║
║  CVC         : Any 3 digits     (e.g. 123)                   ║
║  Name        : Any name                                       ║
║  Email       : Use YOUR real email (stored in DB)             ║
║  Address     : Any  (e.g. 1 Test St, New York, NY 10001)     ║
║                                                               ║
║  Other test scenarios:                                        ║
║  Payment declined   : 4000 0000 0000 0002                    ║
║  Insufficient funds : 4000 0000 0000 9995                    ║
║  3D Secure required : 4000 0025 0000 3155                    ║
╚═══════════════════════════════════════════════════════════════╝

Payment links (open in browser or on device):
  Monthly    : [PAYCRAFT_STRIPE_LINK_MONTHLY]
  Quarterly  : [PAYCRAFT_STRIPE_LINK_QUARTERLY]
  Semiannual : [PAYCRAFT_STRIPE_LINK_SEMIANNUAL]
  Yearly     : [PAYCRAFT_STRIPE_LINK_YEARLY]

"Complete the Monthly payment now. Use your real email address."
"After payment succeeds, return here and press [C]."
""
"[C] Payment done — verify now   [S] Skip   [Q] Quit"
```

Wait for [C], [S], or [Q].

---

## STEP 5B.2 — Ask email used in payment

```
ASK: "What email did you enter during checkout?"
STORE: test_email = entered email
```

---

## STEP 5B.3 — Poll DB for webhook delivery (30-second timeout)

```
POLL every 3 seconds for up to 30 seconds:
  GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?email=eq.[test_email]
      Header: apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
              Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

  IF response non-empty AND status = "active": STOP → webhook received ✓

IF timeout (30s):
  DISPLAY:
    "✗ Webhook not received after 30 seconds."
    ""
    "Troubleshoot:"
    "  1. Stripe Dashboard (Test mode) → Developers → Webhooks → Recent Deliveries"
    "     → Find the delivery → check for errors"
    "  2. Supabase function logs:"
    "     supabase functions logs stripe-webhook --project-ref [ref]"
    "  3. Confirm STRIPE_WEBHOOK_SECRET in Supabase secrets matches"
    "     the 'Signing secret' shown in Stripe Dashboard → Webhooks → [endpoint]"
    "  4. Confirm payment succeeded:"
    "     https://dashboard.stripe.com/test/payments"
    ""
    "[R] Retry (30s)   [M] Enter email manually   [Q] Quit"

OUTPUT: "✓ Webhook received"
        "  Email  : [test_email]"
        "  Plan   : [response[0].plan]"
        "  Status : [response[0].status]"
        "  Expires: [response[0].current_period_end]"
```

---

## STEP 5B.4 — Verify is_premium() via anon key

```
POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/is_premium
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[test_email]"}

VERIFY: HTTP 200 AND body = true
IF false: HARD STOP — "is_premium() returned false despite active row. Check RPC SQL."
OUTPUT: "✓ is_premium() = true for [test_email]"
```

---

## STEP 5B.5 — Verify get_subscription() returns friendly plan name

```
POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/get_subscription
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[test_email]"}

VERIFY: HTTP 200 AND response[0].status = "active"
CHECK: plan field = one of [monthly/quarterly/semiannual/yearly]
IF plan starts with "price_":
  DISPLAY: "⚠️ Plan stored as Stripe price_id — not the friendly name."
           "Fix: Verify payment link has metadata[plan_id] set in Stripe Dashboard."
           "Fix: Verify stripe-webhook/index.ts reads session.metadata?.plan_id first."
OUTPUT: "✓ get_subscription() → plan=[plan] status=active"
```

---

## STEP 5B.6 — Real device verification with debug logs

```
--- 5B.6.0: Check IS_TEST_MODE ---

GREP: {configure_file} (from memory) OR Grep "IS_TEST_MODE" in {target_app_path}/**/*.kt
IF IS_TEST_MODE = false:
  DISPLAY:
    "⚠️  IS_TEST_MODE = false — app is in LIVE mode."
    "Sandbox test requires IS_TEST_MODE = true in PayCraftConfig.kt."
    "Set it to true and rebuild before proceeding."
    "[C] Done — set to true + rebuilt   [S] Skip device check (API-only)"
  WAIT for [C] or [S]
IF IS_TEST_MODE = true:
  OUTPUT: "✓ IS_TEST_MODE = true (TEST mode — sandbox cards)"

--- 5B.6.1: Build + install on device ---

DISPLAY:
"Run in terminal to install on connected device/emulator:"
"  ./gradlew :cmp-android:installDebug"
""
"Then open logcat with the PayCraft filter:"
"  adb logcat -s \"PayCraft:D\" \"*:S\""
""
"[C] App installed and logcat running   [S] Skip (no device)"
WAIT for [C] or [S]. IF [S]: skip to 5B.6.6.

--- 5B.6.2: Verify configure() log on app launch ---

DISPLAY:
"Expected logs on app startup (PayCraft.configure() call):"
""
"  D PayCraft: ══ PayCraft.configure() ═════════════════════════════"
"  D PayCraft:   Provider     = stripe | TEST mode (sandbox — use 4242 test cards)"
"  D PayCraft:   Supabase URL = https://[ref].supabase.co"
"  D PayCraft:   Plans ([n]): monthly, yearly ..."
"  D PayCraft:   Test links   = ✓ [n]/[n] configured"
"  D PayCraft:   Filter: adb logcat -s \"PayCraft:D\" \"*:S\""
"  D PayCraft: ════════════════════════════════════════════════════"
""
"Key checks:"
"  ✓ Provider line shows 'TEST mode' (not LIVE)"
"  ✓ Test links show ✓ [n]/[n] — not ⚠ 0/n"
""
"[✓] Logs match expected   [✗] Logs wrong or missing → run diagnosis"
WAIT.

--- 5B.6.3: Verify refreshStatus() log on paywall open ---

DISPLAY:
"Navigate to the paywall/settings screen. Expected logs:"
""
"  D PayCraft: refreshStatus() → checking status for: [test_email]"
"  D PayCraft: RPC is_premium(email=[test_email])"
"  D PayCraft:   ↳ is_premium result: false"   ← (before payment — correct)
""
"[✓] Logs correct   [✗] No logs → check PayCraftLogger.enabled and Koin wiring"

--- 5B.6.4: Verify checkout log on plan tap ---

DISPLAY:
"Tap a plan (e.g. Monthly) to open checkout. Expected log:"
""
"  D PayCraft: checkout — plan=monthly, mode=TEST"
"  D PayCraft:   Opening: https://buy.stripe.com/test_..."
""
"[✓] Checkout log appeared   [✗] Missing"

--- 5B.6.5: Verify premium state in app after checkout ---

DISPLAY:
"Complete checkout with card 4242 4242 4242 4242, return to app."
"Background + foreground the app (triggers ON_RESUME refresh)."
""
"Expected logs after ON_RESUME:"
""
"  D PayCraft: refreshStatus() → checking status for: [test_email]"
"  D PayCraft: RPC is_premium(email=[test_email])"
"  D PayCraft:   ↳ is_premium result: true"
"  D PayCraft: ✓ isPremium=true — email=[test_email], plan=monthly, ..."
""
"Expected UI:"
"  ✓ PayCraftBanner shows PREMIUM / Manage state"
"  ✓ Plan name shown (e.g. 'Monthly') — not a price_xxx ID"
"  ✓ 'Manage Subscription' button visible"
""
"[✓] Logs + UI correct   [✗] Still showing Upgrade → run diagnosis   [S] Skip"
WAIT.

--- 5B.6.6: Fallback — API-only verification (no device) ---

IF arrived here via [S]:
  DISPLAY:
    "✓ API verification complete (device check skipped)."
    "  Run device verification later via: /paycraft-adopt → [E] Verify only"
```

IF [✗] at any step: run STEP 5B.6B (KMP diagnosis checklist)
IF [✓] or [S]: proceed to 5B.7

---

## STEP 5B.6B — Diagnose premium state not showing in app

```
CHECK 1: Does SettingsScreen.kt (commonMain) contain LifecycleEventEffect(Lifecycle.Event.ON_RESUME)?
  Grep: LifecycleEventEffect in feature/settings/src/commonMain/**/*.kt
  IF missing: "Add LifecycleEventEffect(ON_RESUME) { payCraftBillingManager.refreshStatus() } to SettingsScreen"

CHECK 2: Is BillingManager injected in SettingsScreen.kt (not in MainActivity)?
  Grep: BillingManager OR payCraftBillingManager in SettingsScreen.kt
  IF missing: "Add payCraftBillingManager: BillingManager = koinInject() parameter to SettingsScreen"

CHECK 3: Is PayCraftModule in Koin?
  Grep: PayCraftModule in KoinModules.kt
  IF missing: "Add PayCraftModule to the includes(...) list in KoinModules"

CHECK 4: Is BillingManager.logIn(email) called with the user's email?
  Grep: billingManager.logIn OR payCraftBillingManager.logIn in commonMain
  IF missing: "Call payCraftBillingManager.logIn(email) when user sets email (e.g. in Restore flow)"

DISPLAY all findings. User fixes, then re-checks.
```

---

## STEP 5B.7 — Write sandbox test result

```
WRITE: {target_app_path}/.paycraft/test_results/sandbox_test.json
{
  "tested_at": "[ISO8601 UTC]",
  "email_used": "[test_email]",
  "plan_tested": "[plan]",
  "webhook_received": true,
  "is_premium_api": true,
  "plan_id_correct": [true/false],
  "app_premium_state": "[confirmed/skipped]",
  "result": "PASS"
}

OUTPUT:
"╔══ PHASE 5B COMPLETE — Sandbox Test ════════════════════════════╗"
"║                                                                  ║"
"║  ✓ Test payment completed (card: 4242...)                       ║"
"║  ✓ Stripe webhook fired → subscription row in DB               ║"
"║  ✓ is_premium() = true via anon key                            ║"
"║  ✓ get_subscription() → plan=[plan] status=active              ║"
"║  ✓ Logcat: TEST mode confirmed in configure() log              ║"
"║  ✓ App premium state: [confirmed/skipped]                      ║"
"║                                                                  ║"
"║  Ready to go live? → run /paycraft-adopt → [C] Test live       ║"
"║  Need live keys?   → run /paycraft-adopt → [D] Keys guide      ║"
"╚══════════════════════════════════════════════════════════════════╝"
```
