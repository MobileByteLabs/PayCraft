# /paycraft-adopt-live — Phase 5C: Live E2E Test

> Loaded by `/paycraft-adopt` when user selects **[C] Test live**.
> Tests the complete flow with a real payment card.
> A real charge is made — verify app state, then refund immediately.
> Run ONLY after Phase 5B (sandbox) passes.

---

## Prerequisites

```
VERIFY Phase 5B result: Read .paycraft/test_results/sandbox_test.json → result = "PASS"
IF missing or result != "PASS":
  HARD STOP: "Complete Phase 5B (sandbox test) before running live test."
             "Run /paycraft-adopt → [B] Test sandbox first."

Read .env → MUST be ✓:
  - PAYCRAFT_STRIPE_LIVE_SECRET_KEY starts with "sk_live_"
  - PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY (or equivalent) set
  - PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET starts with "whsec_"
  - PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY set

IF any missing:
  DISPLAY:
    "Missing live keys. Run /paycraft-adopt → [D] Keys guide to obtain them."
    "Then run /paycraft-adopt → [F] Fix phase → Phase 3 (with PAYCRAFT_MODE=live)"
    "to create live Stripe products + payment links."
  → STOP
```

---

## STEP 5C.1 — Flip to live mode + verify debug logs

```
--- 5C.1.0: Set IS_TEST_MODE = false ---

GREP: {configure_file} (from memory) OR Grep "IS_TEST_MODE" in {target_app_path}/**/*.kt
IF IS_TEST_MODE = true:
  DISPLAY:
    "⚠️ App is still in TEST mode (IS_TEST_MODE = true in PayCraftConfig.kt)."
    "For live test, set IS_TEST_MODE = false and rebuild the app."
    "[C] I've set IS_TEST_MODE = false and rebuilt   [S] Skip — test API only (no app)"
  IF [S]: skip to 5C.2 (API-only path)
  WAIT: [C]

--- 5C.1.1: Rebuild + install ---

DISPLAY:
"Run:"
"  ./gradlew :cmp-android:installDebug"
""
"Then start logcat:"
"  adb logcat -s \"PayCraft:D\" \"*:S\""
""
"[C] Done   [S] Skip device verification"
WAIT.

--- 5C.1.2: Verify configure() shows LIVE mode ---

DISPLAY:
"Expected logs on app startup:"
""
"  D PayCraft: ══ PayCraft.configure() ═════════════════════════════"
"  D PayCraft:   Provider     = stripe | LIVE mode (production — real cards)"
"  D PayCraft:   Supabase URL = https://[ref].supabase.co"
"  D PayCraft:   Plans ([n]): monthly, yearly ..."
"  D PayCraft:   Live links   = ✓ [n]/[n] configured"
"  D PayCraft: ════════════════════════════════════════════════════"
""
"Key check: Provider line MUST say 'LIVE mode'."
"If it still shows 'TEST mode' → IS_TEST_MODE is still true or rebuild did not complete."
""
"[✓] Shows LIVE mode   [✗] Still shows TEST mode → rebuild failed"
WAIT.
```

---

## STEP 5C.2 — Confirm live Supabase secrets are updated

```
CHECK Supabase function secrets:
  ACTION: supabase secrets list --project-ref [ref]
  VERIFY: STRIPE_SECRET_KEY digest reflects live key

IF not updated:
  DISPLAY:
    "Update Supabase function secrets for live mode:"
    "  supabase secrets set STRIPE_SECRET_KEY=[PAYCRAFT_STRIPE_LIVE_SECRET_KEY]"
    "                       STRIPE_WEBHOOK_SECRET=[PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET]"
    "                       --project-ref [ref]"
    "[C] Done   [Q] Quit"
  WAIT: [C]
```

---

## STEP 5C.3 — Display live payment instructions

```
DISPLAY:
"╔══ Live Payment Test ════════════════════════════════════════════╗"
"║                                                                   ║"
"║  ⚠️  This will charge a real card. Refund immediately after.     ║"
"║                                                                   ║"
"║  Live payment links:                                             ║"
"║  Monthly    : [PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY]               ║"
"║  (Use monthly — smallest amount, easiest to refund)             ║"
"║                                                                   ║"
"║  Use a real card you can refund (your own card recommended).    ║"
"║  After payment, refund at:                                       ║"
"║  https://dashboard.stripe.com/payments → find payment → Refund  ║"
"║                                                                   ║"
"║  [C] Open payment link + complete payment, then return here     ║"
"║  [S] Skip live test (keep test mode)                            ║"
"╚═════════════════════════════════════════════════════════════════╝"

IF [S]: mark live test as skipped, stop
IF [C]: ASK "What email did you use?" → store live_email
```

---

## STEP 5C.4 — Poll DB + verify (live keys)

```
POLL every 3 seconds for up to 30 seconds:
  GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?email=eq.[live_email]
      apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
      Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

  IF response non-empty AND status = "active": STOP → webhook received ✓

IF timeout (30s):
  DISPLAY:
    "Troubleshoot live webhook:"
    "  1. Stripe Dashboard (LIVE mode) → Developers → Webhooks → Recent Deliveries"
    "  2. Confirm endpoint URL: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook"
    "  3. Confirm STRIPE_WEBHOOK_SECRET in Supabase matches the LIVE webhook signing secret"
    "     (Live and test webhooks have DIFFERENT signing secrets — easy to mix up)"
    "  4. Check function logs: supabase functions logs stripe-webhook --project-ref [ref]"
    "[R] Retry (30s)   [Q] Quit"

Run same checks as Phase 5B steps 5B.4 + 5B.5 (is_premium, get_subscription) using live_email.
```

---

## STEP 5C.5 — Verify live premium state in app via debug logs + refund

```
--- 5C.5.1: Verify checkout + ON_RESUME logs ---

IF device is connected (not skipped in 5C.1):
  DISPLAY:
  "After completing checkout, background + foreground the app."
  "Expected ON_RESUME logs:"
  ""
  "  D PayCraft: checkout — plan=monthly, mode=LIVE"
  "  D PayCraft:   Opening: https://buy.stripe.com/..."
  ""
  "  [after returning to app]"
  "  D PayCraft: refreshStatus() → checking status for: [live_email]"
  "  D PayCraft: RPC is_premium(email=[live_email])"
  "  D PayCraft:   ↳ is_premium result: true"
  "  D PayCraft: ✓ isPremium=true — email=[live_email], plan=monthly, provider=stripe, ..."
  ""
  "Expected UI:"
  "  ✓ PayCraftBanner shows PREMIUM / Manage state (LIVE mode)"
  "  ✓ 'Manage Subscription' opens live portal"
  ""
  "[✓] Logs + UI correct   [S] Skip (API verified only)"
  WAIT.

--- 5C.5.2: Flip back to TEST mode ---

DISPLAY:
"⚠️  IMPORTANT: Set IS_TEST_MODE = true in PayCraftConfig.kt"
"Live test is complete. Leaving IS_TEST_MODE = false means real charges on every test run."
""
"[C] Done — set back to IS_TEST_MODE = true"
WAIT: [C]

--- 5C.5.3: Refund ---

DISPLAY:
"╔══ Refund the live test charge ══════════════════════════════════╗"
"║                                                                   ║"
"║  Refund immediately via Stripe Dashboard:                        ║"
"║  https://dashboard.stripe.com/payments                           ║"
"║  → Find the payment → Actions → Refund                          ║"
"║                                                                   ║"
"║  [✓] Refund issued   [S] Skip (keeping the subscription)        ║"
"╚═════════════════════════════════════════════════════════════════╝"
WAIT.
```

---

## STEP 5C.6 — Write live test result

```
WRITE: {target_app_path}/.paycraft/test_results/live_test.json
{
  "tested_at": "[ISO8601 UTC]",
  "email_used": "[live_email]",
  "plan_tested": "monthly",
  "webhook_received": true,
  "is_premium_api": true,
  "app_premium_state": "[confirmed/skipped]",
  "refund_issued": [true/false],
  "result": "PASS"
}

OUTPUT:
"╔══ PHASE 5C COMPLETE — Live Test ═══════════════════════════════╗"
"║                                                                  ║"
"║  ✓ Live payment processed (real card)                          ║"
"║  ✓ Webhook fired → subscription row in DB                      ║"
"║  ✓ is_premium() = true (live mode)                             ║"
"║  ✓ Logcat: LIVE mode confirmed in configure() log              ║"
"║  ✓ Logcat: isPremium=true after ON_RESUME                      ║"
"║  ✓ App shows premium state                                     ║"
"║  ✓ IS_TEST_MODE flipped back to true                           ║"
"║  ✓ Refund issued: [yes/no]                                     ║"
"║                                                                  ║"
"║  STATUS: FULLY OPERATIONAL — LIVE MODE ✓                       ║"
"╚══════════════════════════════════════════════════════════════════╝"
```
