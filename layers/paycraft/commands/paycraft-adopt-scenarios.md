# /paycraft-adopt-scenarios — Phase 5T: Test Scenarios

> **PHASE 5T** — Loaded by `/paycraft-adopt` when user selects **[T] Test scenarios**.
> Renders scenario matrix from `.paycraft/paycraft-matrix.yaml`, picks a scenario,
> runs PREREQ → SETUP → TEST → VERIFY → SELF-HEAL → TEARDOWN → WRITE-BACK.
> All 15 scenarios fully specified. State stored in YAML; logic is here.

---

## STEP 5T.0 — Load matrix state

```
MATRIX_PATH = {TARGET_APP_PATH}/.paycraft/paycraft-matrix.yaml

IF not found:
  DISPLAY: "⚠️  paycraft-matrix.yaml not found."
           "Creating from template..."
  COPY layers/paycraft/templates/paycraft-matrix.yaml → MATRIX_PATH
  SET project: "{project_name from memory.json or TARGET_APP_PATH basename}"
  SET last_updated: "{now ISO8601}"
  OUTPUT: "✓ paycraft-matrix.yaml created at {MATRIX_PATH}"

READ MATRIX_PATH → load all scenario statuses, last_run dates, matrix_state cache.
```

---

## STEP 5T.1 — Display scenario matrix

```
╔══ /paycraft-adopt — Test Scenarios ══════════════════════════════════════════╗
║  Source: .paycraft/paycraft-matrix.yaml                                        ║
║                                                                                ║
║  PURCHASE                                                                      ║
║  [S1]  New purchase — sandbox           [⬜/✅/❌]  last: {date or never}      ║
║  [S2]  New purchase — live (real card)  [⬜/✅/❌]  last: {date or never}      ║
║                                                                                ║
║  RESTORE                                                                       ║
║  [S3]  Restore: token cached            [⬜/✅/❌]  last: {date or never}      ║
║  [S4]  Restore: clear data, same device [⬜/✅/❌]  last: {date or never}      ║
║  [S5]  Restore: same device_id, new install  [⬜/✅/❌]  last: {date or never} ║
║                                                                                ║
║  DEVICE CONFLICT                                                               ║
║  [S6]  Conflict: active sub + new device     [⬜/✅/❌]  last: {date or never} ║
║  [S7]  Conflict: OTP verification flow       [⬜/✅/❌]  last: {date or never} ║
║  [S8]  Conflict: OAuth (Google) resolution   [⬜/✅/❌]  last: {date or never} 📱 ║
║  [S9]  Conflict: transfer accepted           [⬜/✅/❌]  last: {date or never} ║
║                                                                                ║
║  NEGATIVE / EDGE CASES                                                         ║
║  [S10] Expired subscription                  [⬜/✅/❌]  last: {date or never} ║
║  [S11] Revoked device token                  [⬜/✅/❌]  last: {date or never} ║
║  [S12] OTP rate limit gate                   [⬜/✅/❌]  last: {date or never} ║
║  [S14] Fresh user — no subscription          [⬜/✅/❌]  last: {date or never} ║
║  [S15] Cancelled-in-period — still premium   [⬜/✅/❌]  last: {date or never} ║
║                                                                                ║
║  MIGRATION / BACKFILL                                                          ║
║  [S13] device_id backfill on re-register     [⬜/✅/❌]  last: {date or never} ║
║                                                                                ║
║  ⬜ = pending   ✅ = pass   ❌ = fail                                          ║
║  📱 = device required (cannot run API-only)                                    ║
║                                                                                ║
║  [S1..S15] Run specific scenario                                               ║
║  [R] Run all pending     [C] Run category    [A] Run all                       ║
║  [O] Optional (S16/S17)  [B] Back to menu                                     ║
╚════════════════════════════════════════════════════════════════════════════════╝
```

**`[C] Run category` logic:**
```
DISPLAY: "Which category?"
  [1] Purchase  [2] Restore  [3] Conflict  [4] Negative  [5] Migration
WAIT → run all scenarios in that category in dependency order.
```

**`[R] Run all pending` order** (dependency-resolved, topological sort):
S14 → S12 → S13 → S1 → S3 → S4 → S5 → S10 → S11 → S6 → S7 → S9 → S15 → S2
(S8 skipped automatically — device required; displayed as `[skipped — device needed 📱]`)

---

## SCENARIO RUNNER — Pattern for every scenario

```
Pattern: PREREQ CHECK → SETUP → TEST → VERIFY → SELF-HEAL → TEARDOWN → WRITE-BACK

WRITE-BACK always runs (pass OR fail), after TEARDOWN.
TEARDOWN always runs (even if VERIFY fails) — protect data integrity.
```

---

## S1 — New purchase — sandbox

```
PREREQ:
  Grep {target_app_path}/**/*.kt for IS_TEST_MODE → must be true
  GET .env PAYCRAFT_STRIPE_TEST_SECRET_KEY → must start with sk_test_
  IF either fails: HARD STOP "S1 requires test mode. Set IS_TEST_MODE=true and verify sk_test_ key."

SETUP: none (real Stripe test payment required)

TEST: Route to paycraft-adopt-sandbox.md Phase 5B (full flow).
  This handles payment link display, webhook polling, is_premium check, app verification.

VERIFY: Handled within Phase 5B (5B.3–5B.5).

SELF-HEAL: Handled within Phase 5B (5B.6B).

TEARDOWN: none (test subscription in DB is valid — leave it for S3–S15 restore scenarios)

WRITE-BACK → .paycraft/paycraft-matrix.yaml scenarios[S1]:
  (written by paycraft-adopt-sandbox.md STEP 5B.7 — see Step 4 of plan)
```

---

## S2 — New purchase — live

```
PREREQ:
  READ .paycraft/paycraft-matrix.yaml → scenarios[S1].status
  IF status != "pass":
    HARD STOP: "Run S1 (sandbox test) first. S2 requires a confirmed working sandbox."
  GET .env PAYCRAFT_STRIPE_LIVE_SECRET_KEY → must start with sk_live_
  IF missing: HARD STOP "Live key not set. Run [D] Keys guide to obtain sk_live_ key."

SETUP: none (real payment)

TEST: Route to paycraft-adopt-live.md Phase 5C.

VERIFY: Handled within Phase 5C.

SELF-HEAL: Handled within Phase 5C.

TEARDOWN: none
  NOTE: Real charge made — remind user to cancel/refund in Stripe Dashboard.

WRITE-BACK → scenarios[S2]:
  (written by paycraft-adopt-live.md STEP 5C.6 — see Step 5 of plan)
```

---

## S3 — Restore: token cached (fast path)

```
PREREQ:
  READ scenarios[S1].status → must be "pass"
  IF not: HARD STOP "Run S1 first to create a test subscription."

ASK: "Email for restore test:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET {URL}/rest/v1/registered_devices
      ?email=eq.{email}&is_active=eq.true&order=registered_at.desc&limit=1
      Authorization: Bearer {SERVICE_ROLE_KEY}
  IF no row: HARD STOP "No active device row for {email}. Run S1 to create one."
  STORE: active_token = row.device_token
  STORE: stored_device_id = row.device_id
  STORE: stored_device_name = row.device_name

TEST (API-only):
  POST {URL}/rest/v1/rpc/register_device
    Body: {p_email:email, p_platform:"android", p_device_name:stored_device_name,
           p_device_id:stored_device_id, p_mode:"test"}
    Header: apikey: {ANON_KEY}
  STORE: result

VERIFY:
  A. result.conflict = false
  B. result.device_token = active_token   ← SAME token returned = fast path hit
  C. POST check_premium_with_device({email}, {active_token}, "test") → is_premium=true, token_valid=true

SELF-HEAL (if B fails — new token returned instead of same):
  [SUGGEST] "Fast path not taken — device_id in request did not match stored row."
  CHECK: Is stored_device_id null?
    IF null: [SUGGEST] "Run S13 (device_id backfill) first, then retry S3."
  CHECK: Was p_device_id sent correctly? Log sent value vs stored row value.

TEARDOWN: none (state unchanged)

WRITE-BACK → scenarios[S3]:
  status: "pass"/"fail"
  last_run: {ISO8601}
  email_used: {email}
  fail_reason: null/"fast_path_miss"/"token_invalid"
  result_detail: {description}
```

---

## S4 — Restore: clear data, same device

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET registered_devices?email=eq.{email}&is_active=eq.true&order=registered_at.desc&limit=1
  IF no row: HARD STOP "No active device row. Run S1 first."
  STORE: saved_device_id = row.device_id
         saved_device_name = row.device_name
         saved_token = row.device_token

  -- Simulate "clear app data": delete the active row from DB
  DELETE {URL}/rest/v1/registered_devices
    ?device_token=eq.{saved_token}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: active device row deleted (simulating cleared app data)"

TEST (API-only):
  POST /rest/v1/rpc/register_device
    {p_email:email, p_platform:"android", p_device_name:saved_device_name,
     p_device_id:saved_device_id, p_mode:"test"}
  STORE: result

VERIFY:
  NOTE: The old row was DELETED. The RPC creates a NEW token.
        This is CORRECT behavior — same device re-registers after clear-data.
  A. result.conflict = false  (active sub exists but NO OTHER active device → no conflict)
  B. result.device_token != saved_token  (new token — expected after row deletion)
  C. GET registered_devices?email=eq.{email}&is_active=eq.true → exactly 1 row
  D. POST check_premium_with_device({email}, {result.device_token}, "test") → is_premium=true, token_valid=true

SELF-HEAL (if A fails — conflict=true):
  [AUTO] GET registered_devices?email=eq.{email}&is_active=eq.true → count rows
  IF count > 1: "Multiple active rows. Delete stale rows manually."
  IF count = 1 AND row != saved_token: "Unexpected active device exists (not from setup)."
SELF-HEAL (if D fails — token_valid=false):
  [SUGGEST] "New token not activated. Check register_device() INSERT — is_active should=true when no other active device."

TEARDOWN: none (new active row is valid — user is restored post-clear-data)

WRITE-BACK → scenarios[S4]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S5 — Restore: same device_id, new install

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET registered_devices?email=eq.{email}&is_active=eq.true&order=registered_at.desc&limit=1
  IF no row: HARD STOP "No active device row. Run S3 or S4 to restore first."
  STORE: existing_device_id = row.device_id
         existing_token = row.device_token
         original_device_name = row.device_name
  IF existing_device_id = null: HARD STOP "device_id is null — run S13 first to backfill."
  DISPLAY: "✓ Setup: active row found with device_id={existing_device_id}"

TEST (API-only — same device_id, different device_name suffix = new install):
  POST /rest/v1/rpc/register_device
    {p_email:email, p_platform:"android",
     p_device_name:"{original_device_name} (reinstalled)",
     p_device_id:existing_device_id,
     p_mode:"test"}
  STORE: result

VERIFY:
  A. result.conflict = false
  B. result.device_token = existing_token  (same device_id → same token returned)
  C. POST check_premium_with_device({email}, {existing_token}, "test") → is_premium=true

SELF-HEAL (if B fails — new token returned):
  [SUGGEST] "Same device_id sent but new token returned."
  CHECK: Compare p_device_id sent vs DB row device_id (case sensitivity? whitespace?).
  CHECK: Is migration 009 applied? SELECT COUNT(*) FROM information_schema.columns
         WHERE table_name='registered_devices' AND column_name='device_id' → must be 1.

TEARDOWN:
  PATCH {URL}/rest/v1/registered_devices?device_token=eq.{existing_token}
    Body: {device_name:"{original_device_name}"}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Teardown: device_name restored"

WRITE-BACK → scenarios[S5]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S6 — Device conflict: active sub + new device

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email with active test subscription:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  -- Verify active subscription
  GET subscriptions?email=eq.{email}&status=eq.active&mode=eq.test
  IF no row: HARD STOP "No active test subscription for {email}. Run S1 first."

  -- Clean slate: revoke any existing active devices
  PATCH {URL}/rest/v1/registered_devices
    ?email=eq.{email}&is_active=eq.true
    Body: {is_active:false, revoked_at:"{now}", revoked_by:"test_setup_s6"}
    Authorization: Bearer {SERVICE_ROLE_KEY}

  -- Insert Device A as the sole active device
  POST {URL}/rest/v1/registered_devices
    Body: {email:email, device_token:"test-device-a-token-s6",
           platform:"android", device_name:"Test Device A (S6)",
           device_id:"test-device-a-id-s6", mode:"test", is_active:true}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: Device A registered as active for {email}"

TEST:
  POST /rest/v1/rpc/register_device
    {p_email:email, p_platform:"android",
     p_device_name:"Test Device B (S6)",
     p_device_id:"test-device-b-id-s6",
     p_mode:"test"}
  STORE: result

VERIFY:
  A. result.conflict = true
  B. result.conflicting_device_name = "Test Device A (S6)"
  C. result.conflicting_last_seen is not null
  D. GET registered_devices?device_token=eq.{result.device_token} → is_active=false (pending)

SELF-HEAL (if A fails — conflict=false):
  [AUTO] GET subscriptions?email=eq.{email}&mode=eq.test → check status + current_period_end
  IF status != "active" OR current_period_end < now():
    [SUGGEST] "Subscription expired/inactive. Run S1 first to create valid test sub."
  IF status = "active":
    CHECK: mode mismatch? sub.mode vs p_mode.
    [SUGGEST] "Mode mismatch: subscription.mode={sub.mode} but p_mode=test."
    CHECK: Device A row is_active=true?
    IF false: [SUGGEST] "Device A INSERT may have failed. Check SERVICE_ROLE_KEY."

TEARDOWN:
  DELETE {URL}/rest/v1/registered_devices
    ?email=eq.{email}&device_id=in.(test-device-a-id-s6,test-device-b-id-s6)
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Teardown: test device rows removed"
  IF DELETE fails:
    DISPLAY: "⚠️  Teardown failed. Remove manually:"
             "  DELETE FROM registered_devices WHERE device_id LIKE 'test-device-%-s6'"

WRITE-BACK → scenarios[S6]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S7 — Device conflict: OTP verification flow

```
PREREQ:
  READ scenarios[S6].status → must be "pass" (S6 setup worked)

NOTE: S6 teardown ran after S6. S7 needs to re-create conflict state.
SETUP: Re-run S6 SETUP steps (Device A active for email, Device B to register below)

TEST (API path + optional device path):
  -- Register Device B → trigger conflict
  POST register_device({p_email:email, p_platform:"android",
    p_device_name:"Test Device B (S7)", p_device_id:"test-device-b-id-s7", p_mode:"test"})
  STORE: reg = result (conflict=true expected)
  IF reg.conflict != true: HARD STOP "Conflict not triggered in S7 setup. Fix S6 first."

  -- Verify OTP gate is available
  POST {URL}/rest/v1/rpc/check_otp_gate
    Header: apikey: {ANON_KEY}
    Body: {}
  STORE: gate
  DISPLAY:
    "✓ API check: OTP gate available (sends_today={gate.sends_today}, limit=300)"
    ""
    "📱 Full OTP flow requires a real device:"
    "  1. App shows DeviceConflict sheet with 'Verify via Email' button"
    "  2. Tap → app calls sendOtp({email}) → OTP email arrives"
    "  3. Enter code → verifyOtp() returns true → transfer_to_device() called"
    "  4. Device B becomes active, Device A revoked"
    ""
    "[C] I completed OTP flow on device — mark pass"
    "[S] Skip device step — mark API-only pass"

IF [C] — verify on device:
  GET registered_devices?device_id=eq.test-device-b-id-s7 → is_active = true
  GET otp_send_log?log_date=eq.{today} → send_count incremented by 1

SELF-HEAL (if OTP email not received):
  [AUTO] GET Supabase secrets → check BREVO_API_KEY present
  IF missing: [SUGGEST] "BREVO_API_KEY not deployed. Run Phase 2 Step 2.14 (SMTP setup)."
  IF present: [SUGGEST] "Check spam folder. Verify Brevo sender domain is verified."

TEARDOWN: same as S6 TEARDOWN pattern
  DELETE registered_devices WHERE device_id LIKE 'test-device-%-s7'

WRITE-BACK → scenarios[S7]:
  status: "pass"/"fail"/"skipped" (if [S])
  last_run, email_used, otp_verified: true/false/skipped, fail_reason, result_detail
```

---

## S8 — Device conflict: OAuth (Google) resolution

```
PREREQ:
  READ scenarios[S6].status → must be "pass"

SETUP: Re-run S6 SETUP (Device A active, Device B in conflict state with "test-device-b-id-s8")

TEST: Device-only. Cannot mock Google ID token via API.

  -- API pre-check: is Google OAuth enabled?
  GET https://api.supabase.com/v1/projects/{PAYCRAFT_SUPABASE_PROJECT_REF}/config/auth
    Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
  CHECK: external_google_enabled = true
  IF false: HARD STOP "Google OAuth not enabled in Supabase. Run [O] OAuth setup first."

  DISPLAY:
    "📱 S8 requires a real device with Google Sign-In."
    ""
    "Steps:"
    "  1. On device: open app → trigger restore → DeviceConflict sheet appears"
    "  2. Tap 'Verify with Google' → Google Sign-In completes"
    "  3. App calls verifyOAuthToken(GOOGLE, idToken) → returns verified email"
    "  4. If email matches → transfer_to_device() → Device B active, Device A revoked"
    ""
    "[C] OAuth flow completed on device"
    "[S] Skip (no device available)"

IF [C]:
  VERIFY: GET registered_devices?device_id=eq.test-device-b-id-s8 → is_active=true

SELF-HEAL (if OAuth fails):
  [SUGGEST] "Check: PAYCRAFT_GOOGLE_WEB_CLIENT_ID in .env matches Google Console."
  [SUGGEST] "Verify Supabase redirect URL is registered in Google OAuth consent screen."

TEARDOWN: DELETE registered_devices WHERE device_id LIKE 'test-device-%-s8'

WRITE-BACK → scenarios[S8]:
  status: "pass"/"fail"/"skipped"
  last_run, email_used, fail_reason, result_detail
```

---

## S9 — Device conflict: transfer accepted

```
PREREQ:
  READ scenarios[S6].status → must be "pass"

SETUP: Re-run S6 SETUP (Device A active, Device B conflict row)
  -- Register Device B to get its pending token
  POST register_device({p_email:email, p_platform:"android",
    p_device_name:"Test Device B (S9)", p_device_id:"test-device-b-id-s9", p_mode:"test"})
  STORE: device_b_token = result.device_token
  IF result.conflict != true: HARD STOP "Conflict not triggered. Fix S6 first."

TEST:
  POST {URL}/rest/v1/rpc/transfer_to_device
    Body: {p_email:email, p_new_token:device_b_token, p_mode:"test"}
    Header: apikey: {ANON_KEY}
  STORE: transfer_result

VERIFY:
  A. transfer_result.transferred = true
  B. GET registered_devices?device_token=eq.{device_b_token} → is_active=true
  C. GET registered_devices?device_id=eq.test-device-a-id-s9 → is_active=false, revoked_by="transfer"
  D. POST check_premium_with_device({email}, {device_b_token}, "test") → is_premium=true, token_valid=true

SELF-HEAL (if A fails — transferred=false):
  [AUTO] Check transfer_result.reason field
  IF reason="token_not_found": [SUGGEST] "Device B token not in DB. S6 setup may have failed."
  ELSE: [SUGGEST] "Check registered_devices for {email} — Device B row may be missing."
SELF-HEAL (if D fails — token_valid=false after transfer):
  [SUGGEST] "Transfer succeeded but check_premium returned token_valid=false."
  CHECK: is_active=true in DB? If yes → check check_premium_with_device() RPC logic.

TEARDOWN:
  DELETE registered_devices WHERE device_id LIKE 'test-device-%-s9'

WRITE-BACK → scenarios[S9]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S10 — Expired subscription

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET subscriptions?email=eq.{email}&mode=eq.test
  IF no row: HARD STOP "No subscription found. Run S1 first."
  STORE: original_period_end = row.current_period_end
         original_status = row.status

  -- Save originals to matrix for safe teardown
  UPDATE .paycraft/paycraft-matrix.yaml scenarios[S10]:
    original_period_end: {value}
    original_status: {value}

  -- Expire the subscription
  PATCH subscriptions?email=eq.{email}&mode=eq.test
    Body: {current_period_end:"2020-01-01T00:00:00Z", status:"active"}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: subscription expired (current_period_end = 2020-01-01)"

TEST:
  POST {URL}/rest/v1/rpc/is_premium
    Body: {user_email:email, stripe_mode:"test"}
    Header: apikey: {ANON_KEY}
  STORE: is_premium_result

  POST /rest/v1/rpc/register_device
    {p_email:email, p_platform:"android",
     p_device_name:"Test Device S10", p_device_id:"test-exp-device-s10", p_mode:"test"}
  STORE: reg_result

VERIFY:
  A. is_premium_result = false
  B. reg_result.conflict = false  (expired sub → no conflict check applies)

SELF-HEAL (if A fails — is_premium=true despite expired sub):
  [SUGGEST] "is_premium() returned true for expired subscription."
  CHECK: is_premium() RPC SQL — verify it checks current_period_end > now().
  [SUGGEST] "Re-run Phase 2 migration 002/004 to ensure RPC uses correct WHERE clause."

TEARDOWN (CRITICAL — must restore):
  PATCH subscriptions?email=eq.{email}&mode=eq.test
    Body: {current_period_end:"{original_period_end}", status:"{original_status}"}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  VERIFY: GET subscriptions → current_period_end = original_period_end
  DELETE registered_devices WHERE device_id='test-exp-device-s10'
  IF teardown fails:
    HARD STOP: "⚠️  TEARDOWN FAILED — subscription still expired!
      Manually: UPDATE subscriptions SET current_period_end='{original_period_end}',
      status='{original_status}' WHERE email='{email}' AND mode='test'"

WRITE-BACK → scenarios[S10]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
  (original_period_end / original_status saved in SETUP — clear them on pass)
```

---

## S11 — Revoked device token

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET registered_devices?email=eq.{email}&is_active=eq.true
      &order=registered_at.desc&limit=1
  IF no row: HARD STOP "No active device. Run S3 or S4 to restore first."
  STORE: active_token = row.device_token

  POST {URL}/rest/v1/rpc/revoke_device
    Body: {p_email:email, p_device_token:active_token, p_mode:"test"}
    Header: apikey: {ANON_KEY}
  DISPLAY: "✓ Setup: token revoked ({active_token[:12]}...)"

TEST:
  POST {URL}/rest/v1/rpc/check_premium_with_device
    Body: {p_email:email, p_device_token:active_token, p_mode:"test"}
    Header: apikey: {ANON_KEY}

VERIFY:
  A. token_valid = false  (revoked token must not validate)
  B. GET registered_devices?device_token=eq.{active_token}
     → is_active=false, revoked_by="user"

SELF-HEAL (if A fails — token_valid=true):
  [SUGGEST] "Revoked token is still validating."
  CHECK: GET registered_devices → is_active still true? Revoke RPC may not have run.
  [AUTO] Re-run revoke_device call and verify DB row.

TEARDOWN:
  NOTE: Token is now revoked. This is expected state for S11.
  DISPLAY: "ℹ️  S11 leaves token revoked. Run S3 or S4 to restore a valid token for further tests."

WRITE-BACK → scenarios[S11]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S12 — OTP rate limit gate

```
PREREQ: none

ASK: "This temporarily sets OTP send_count=300 for today. Proceed? [Y/N]"
IF N: WRITE-BACK status="skipped", STOP.

SETUP:
  -- Check today's otp_send_log row (service role required — RLS blocks anon)
  GET {URL}/rest/v1/otp_send_log?log_date=eq.{today_UTC_date}
      Authorization: Bearer {SERVICE_ROLE_KEY}
  STORE: original_send_count = row.send_count (or 0 if no row)

  -- Save to matrix for teardown safety
  UPDATE .paycraft/paycraft-matrix.yaml scenarios[S12]:
    original_send_count: {value}

  -- Set to limit via UPSERT (1 row per day — PRIMARY KEY = log_date)
  POST {URL}/rest/v1/otp_send_log
    Body: {log_date:"{today_UTC_date}", send_count:300, updated_at:"{now}"}
    Header: Prefer: resolution=merge-duplicates
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: otp_send_log send_count=300 for {today_UTC_date}"

TEST:
  POST {URL}/rest/v1/rpc/check_otp_gate
    Body: {}
    Header: apikey: {ANON_KEY}
  STORE: gate_result

VERIFY:
  A. gate_result.available = false
  B. gate_result.sends_today = 300
  C. gate_result.limit = 300

SELF-HEAL (if A fails — available=true despite send_count=300):
  [AUTO] GET otp_send_log?log_date=eq.{today} → verify row exists with send_count=300
  IF row missing: [AUTO] Re-run UPSERT and retest.
  IF row exists but gate says available: [SUGGEST] "check_otp_gate() SQL may not read otp_send_log. Re-run Phase 2 Step 2.12."

TEARDOWN (CRITICAL):
  PATCH {URL}/rest/v1/otp_send_log?log_date=eq.{today_UTC_date}
    Body: {send_count:{original_send_count}, updated_at:"{now}"}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  VERIFY: GET otp_send_log → send_count = original_send_count
  IF teardown fails:
    HARD STOP: "⚠️  TEARDOWN FAILED — OTP gate still blocked!
      Manually: UPDATE otp_send_log SET send_count={original_send_count}
      WHERE log_date='{today_UTC_date}'"

WRITE-BACK → scenarios[S12]:
  status: "pass"/"fail"
  last_run, fail_reason, result_detail
  (original_send_count cleared on pass)
```

---

## S13 — device_id backfill on re-register

```
PREREQ:
  READ scenarios[S1].status → must be "pass"
  VERIFY migration 009 applied:
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='registered_devices' AND column_name='device_id'
    → cnt must = 1
  IF cnt = 0: HARD STOP "Migration 009 not applied. Run [F] Fix phase → Phase 2 → Step 2.11C."

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  -- Insert legacy row with device_id=null (simulates pre-migration-009 row)
  POST {URL}/rest/v1/registered_devices
    Body: {email:email, device_token:"test-legacy-token-s13",
           platform:"android", device_name:"Legacy Device (S13)",
           device_id:null, mode:"test", is_active:true}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: legacy row inserted (device_id=null, name-based fallback active)"

TEST:
  -- New-client re-register: same device_name (legacy fallback path) + new device_id (backfill)
  POST /rest/v1/rpc/register_device
    {p_email:email, p_platform:"android",
     p_device_name:"Legacy Device (S13)",
     p_device_id:"backfill-test-id-s13",
     p_mode:"test"}
  STORE: result

VERIFY:
  A. result.conflict = false
  B. result.device_token = "test-legacy-token-s13"  (same token — name-based match succeeded)
  C. GET registered_devices?device_token=eq.test-legacy-token-s13
     → device_id = "backfill-test-id-s13"  ← backfill written!

SELF-HEAL (if B fails — new token returned):
  [SUGGEST] "Name-based fallback did not match."
  CHECK: device_name exact case match? "Legacy Device (S13)" vs what was sent.
  CHECK: is_active=true on legacy row? If revoked, fallback skips it.
SELF-HEAL (if C fails — device_id still null):
  [SUGGEST] "Backfill UPDATE not executed. Check migration 009 backfill logic."
  CHECK: Was p_device_id sent in request body? Log request.
  CHECK: Migration 009 backfill condition: p_device_id IS NOT NULL AND v_active_row.device_id IS NULL.

TEARDOWN:
  DELETE {URL}/rest/v1/registered_devices?device_token=eq.test-legacy-token-s13
    Authorization: Bearer {SERVICE_ROLE_KEY}

WRITE-BACK → scenarios[S13]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
```

---

## S14 — Fresh user, no subscription

```
PREREQ: none

SETUP:
  test_fresh_email = "paycraft-s14-{unix_timestamp}@test-noreply.invalid"
  -- Verify it truly doesn't exist
  GET subscriptions?email=eq.{test_fresh_email} → expect empty array
  DISPLAY: "✓ Setup: ephemeral test email {test_fresh_email}"

TEST:
  -- Check is_premium for unknown user
  POST {URL}/rest/v1/rpc/is_premium
    Body: {user_email:test_fresh_email, stripe_mode:"test"}
    Header: apikey: {ANON_KEY}
  STORE: premium_result

  -- Register device for fresh user (should succeed, no conflict possible)
  POST /rest/v1/rpc/register_device
    {p_email:test_fresh_email, p_platform:"android",
     p_device_name:"Fresh User Device", p_device_id:"fresh-device-id-s14", p_mode:"test"}
  STORE: reg_result

VERIFY:
  A. premium_result = false
  B. reg_result.conflict = false  (no subscription → no conflict check fires)
  C. reg_result.device_token starts with "srv_"  (successfully issued)
  D. GET registered_devices?email=eq.{test_fresh_email}&is_active=eq.true → 1 row

SELF-HEAL (if A fails — is_premium=true for unknown email):
  [SUGGEST] "is_premium() returned true for email with no subscription row."
  CHECK: is_premium() RPC — does it default to true on empty SELECT? Should default to false.
SELF-HEAL (if B fails — conflict=true for fresh user):
  [SUGGEST] "Conflict triggered for user with no subscription."
  CHECK: register_device() RPC — v_has_sub check must be false when no subscription row exists.

TEARDOWN:
  DELETE {URL}/rest/v1/registered_devices?email=eq.{test_fresh_email}
    Authorization: Bearer {SERVICE_ROLE_KEY}

WRITE-BACK → scenarios[S14]:
  status: "pass"/"fail"
  last_run, test_email: {test_fresh_email}, fail_reason, result_detail
```

---

## S15 — Cancelled-in-period (still premium)

```
PREREQ:
  READ scenarios[S1].status → must be "pass"

ASK: "Email:" (default: scenarios[S1].email_used)
STORE: email

SETUP:
  GET subscriptions?email=eq.{email}&mode=eq.test
  IF no row: HARD STOP "No subscription found. Run S1 first."
  STORE: original_status = row.status
         original_cancel_flag = row.cancel_at_period_end

  -- Save originals to matrix for teardown safety
  UPDATE .paycraft/paycraft-matrix.yaml scenarios[S15]:
    original_status: {value}
    original_cancel_flag: {value}

  -- Simulate post-cancel-but-pre-expiry: cancel flag set, status still active
  PATCH subscriptions?email=eq.{email}&mode=eq.test
    Body: {status:"active", cancel_at_period_end:true}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  DISPLAY: "✓ Setup: cancel_at_period_end=true (sub will end at period end — still active now)"

TEST:
  POST {URL}/rest/v1/rpc/is_premium
    Body: {user_email:email, stripe_mode:"test"}
    Header: apikey: {ANON_KEY}

VERIFY:
  A. is_premium = true  (still active within period despite cancel flag)

SELF-HEAL (if A fails — is_premium=false):
  [SUGGEST] "is_premium() returned false for subscription still in period."
  CHECK: is_premium() SQL — verify it checks status='active' AND current_period_end > now().
         cancel_at_period_end MUST NOT affect is_premium during the period.
  [SUGGEST] "If RPC filters on cancel_at_period_end, remove that filter."

TEARDOWN (CRITICAL):
  PATCH subscriptions?email=eq.{email}&mode=eq.test
    Body: {status:"{original_status}", cancel_at_period_end:{original_cancel_flag}}
    Authorization: Bearer {SERVICE_ROLE_KEY}
  VERIFY: GET subscriptions → row restored
  IF teardown fails:
    HARD STOP: "⚠️  TEARDOWN FAILED — subscription in wrong state!
      Manually: UPDATE subscriptions SET status='{original_status}',
      cancel_at_period_end={original_cancel_flag} WHERE email='{email}' AND mode='test'"

WRITE-BACK → scenarios[S15]:
  status: "pass"/"fail"
  last_run, email_used, fail_reason, result_detail
  (original_status / original_cancel_flag cleared on pass)
```

---

## SELF-HEAL: Auto-Apply vs Suggest-Only Reference

```
FAILURE                              AUTO-APPLY                       SUGGEST-ONLY
───────────────────────────────────  ──────────────────────────────   ──────────────────────────
HTTP 401 on REST call                Re-read .env key + retry once    "Check SERVICE_ROLE_KEY"
PGRST202 (RPC not found)             —                                "Re-run Phase 2 migrations"
HTTP timeout / network error         Retry once after 3s              "Check internet/project"
conflict=false (expected true)       Re-verify subscription row       Suggest mode or period fix
token_valid=false after transfer     Re-fetch row + verify is_active  Suggest check RPC logic
OTP not received                     Ping Brevo API key in Supabase   Guide: spam/sender verify
device_id not backfilled             Re-fetch row + compare           Suggest check migration 009
Teardown DELETE fails                Retry DELETE with service role   Show manual SQL
is_premium=true (expected false)     Re-query after 2s                Suggest check RPC WHERE
mode mismatch detected               —                                "Align p_mode with sub.mode"
```

Auto-apply executes silently and re-runs the failing VERIFY step.
If auto-apply also fails → escalate to SUGGEST-ONLY + write fail_reason to matrix.

---

## OPTIONAL SCENARIOS

```
[O] Optional → display:

  [S16] Webhook duplicate / replay (idempotency)
    Requires: Stripe Dashboard → Developers → Webhooks → Recent Deliveries → Resend
    (Browser action — cannot be automated via API)
    Steps:
      1. Run S1 to create a subscription
      2. Open Stripe Dashboard → find the checkout.session.completed event
      3. Click "Resend" → webhook fires again
      4. Verify: subscriptions table unchanged (UNIQUE constraint prevents duplicate row)
    Mark: [C] Idempotency confirmed / [S] Skip

  [S17] Wrong mode misconfiguration detection
    Config audit — no DB interaction.
    Steps:
      1. Grep IS_TEST_MODE in PayCraftConfig.kt
      2. Grep PAYCRAFT_MODE in .env
      3. Verify: both say "test" OR both say "live" — mismatch detected
      4. Check: Supabase STRIPE_SECRET_KEY prefix vs IS_TEST_MODE value
    Mark: [C] Config consistent / [W] Warning — mismatch found
```
