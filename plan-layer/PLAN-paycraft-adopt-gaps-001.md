# PLAN-paycraft-adopt-gaps-001 — Fix Gaps in `/paycraft-adopt` Command Suite

**Status**: APPROVED
**Created**: 2026-04-25
**Parent Plan**: `PLAN-paycraft-adopt-001.md`
**Scope**: `workspaces/mbs/PayCraft/` — command files + .env.example + new stubs

---

## Gap Source

Gap analysis run on the 8 command files created by PLAN-paycraft-adopt-001.
33 gaps found across 6 categories. This plan fixes all of them in 4 gates.

---

## Gates Overview

```
Gate 1 — Fix .env.example  (G1, G2, G3, G5)
Gate 2 — Fix command files (G4, G6–G13, G16, C1–C8, minor gaps)
Gate 3 — Create missing files (M1, M2)
Gate 4 — Verify all fixes are consistent end-to-end
```

---

## GATE 1 — Fix `.env.example`

**Gaps fixed**: G1, G2, G3, G5

**File**: `workspaces/mbs/PayCraft/.env.example`

### Changes

**G1 — Add `PAYCRAFT_PROVIDER`**
```diff
+# Payment provider: stripe or razorpay
+PAYCRAFT_PROVIDER=
```
Add after `# ── App Config` section or at the top of the file near `PAYCRAFT_CURRENCY`.

**G2 — Add Stripe test output keys** (written by Phase 3, need to exist as placeholders)
```diff
+# ── Stripe Test Mode (auto-filled by /paycraft-adopt-stripe) ─────────────────
+# Test product ID — created by /paycraft-adopt, safe to delete after setup
+PAYCRAFT_STRIPE_TEST_PRODUCT_ID=
+# Test price IDs per plan — created by /paycraft-adopt-stripe
+PAYCRAFT_STRIPE_TEST_PRICE_MONTHLY=
+PAYCRAFT_STRIPE_TEST_PRICE_QUARTERLY=
+PAYCRAFT_STRIPE_TEST_PRICE_YEARLY=
```

**G3 — Add Razorpay plan output keys** (written by Phase 3B)
```diff
+# ── Razorpay Plans (auto-filled by /paycraft-adopt-razorpay) ─────────────────
+PAYCRAFT_RAZORPAY_PLAN_MONTHLY=
+PAYCRAFT_RAZORPAY_PLAN_QUARTERLY=
+PAYCRAFT_RAZORPAY_PLAN_YEARLY=
```

**G5 — Add dynamic plan keys** (Phase 1.5 writes these; need static stubs for the 3-plan case)
```diff
+# ── Plan Definitions (filled by /paycraft-adopt-env) ─────────────────────────
+# Number of subscription plans (e.g. 2 for monthly+yearly)
+PAYCRAFT_PLAN_COUNT=
+# Plan 1 (example: monthly)
+PAYCRAFT_PLAN_1_ID=
+PAYCRAFT_PLAN_1_NAME=
+PAYCRAFT_PLAN_1_PRICE=
+PAYCRAFT_PLAN_1_INTERVAL=
+PAYCRAFT_PLAN_1_POPULAR=
+# Plan 2 (example: yearly)
+PAYCRAFT_PLAN_2_ID=
+PAYCRAFT_PLAN_2_NAME=
+PAYCRAFT_PLAN_2_PRICE=
+PAYCRAFT_PLAN_2_INTERVAL=
+PAYCRAFT_PLAN_2_POPULAR=
+# Plan 3 (optional quarterly — leave blank if unused)
+PAYCRAFT_PLAN_3_ID=
+PAYCRAFT_PLAN_3_NAME=
+PAYCRAFT_PLAN_3_PRICE=
+PAYCRAFT_PLAN_3_INTERVAL=
+PAYCRAFT_PLAN_3_POPULAR=
```

### Phase 1.1 validation rule update

After adding these keys to `.env.example`, update `paycraft-adopt-env.md` Step 1.1:
- Split required keys into two lists:
  - **Static keys** (always required): Supabase + provider credentials + `PAYCRAFT_PROVIDER`
  - **Dynamic keys** (validated later): `PAYCRAFT_PLAN_*` keys — skip in 1.1, verified in Step 1.5 after collection
- Remove `PAYCRAFT_PLAN_*` and provider-output keys (`STRIPE_TEST_*`, `RAZORPAY_PLAN_*`) from the Step 1.1 mandatory presence check

---

## GATE 2 — Fix Command Files

**Gaps fixed**: G4, G6–G13, G16, G17, G21, G24, C1–C8

### 2A — `paycraft-adopt-env.md`

**G5 (Step 1.1)** — Split validation into static vs dynamic keys:
```
STATIC KEYS (check in Step 1.1):
  PAYCRAFT_SUPABASE_URL, PAYCRAFT_SUPABASE_PROJECT_REF,
  PAYCRAFT_SUPABASE_ANON_KEY, PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY,
  PAYCRAFT_SUPABASE_ACCESS_TOKEN,
  PAYCRAFT_STRIPE_SECRET_KEY, PAYCRAFT_STRIPE_PUBLISHABLE_KEY,
  PAYCRAFT_STRIPE_WEBHOOK_SECRET, PAYCRAFT_STRIPE_LINK_MONTHLY,
  PAYCRAFT_STRIPE_LINK_QUARTERLY, PAYCRAFT_STRIPE_LINK_YEARLY,
  PAYCRAFT_STRIPE_PORTAL_URL,
  PAYCRAFT_RAZORPAY_KEY_ID, PAYCRAFT_RAZORPAY_KEY_SECRET,
  PAYCRAFT_RAZORPAY_WEBHOOK_SECRET,
  PAYCRAFT_RAZORPAY_LINK_MONTHLY, PAYCRAFT_RAZORPAY_LINK_QUARTERLY,
  PAYCRAFT_RAZORPAY_LINK_YEARLY,
  PAYCRAFT_SUPPORT_EMAIL, PAYCRAFT_CURRENCY, PAYCRAFT_APP_REDIRECT_URL,
  PAYCRAFT_PROVIDER,
  PAYCRAFT_PLAN_COUNT, PAYCRAFT_PLAN_1_ID ... PAYCRAFT_PLAN_3_POPULAR
  (all present as empty strings — existence check only, not value check)

DYNAMIC KEYS (skip in Step 1.1 — written later by Phases 3/3B):
  PAYCRAFT_STRIPE_TEST_PRODUCT_ID, PAYCRAFT_STRIPE_TEST_PRICE_*,
  PAYCRAFT_RAZORPAY_PLAN_*

VERIFICATION: "✓ .env ready — [N] keys present, [M] empty (will be filled)"
```

**G14** — Step 1.2: Add provider recommendation:
```
"[1] Stripe   (recommended — Stripe MCP support for automatic setup)"
"[2] Razorpay (manual API calls — MCP not available)"
```

**G15** — Step 1.4: Add Stripe key length validation:
```
VALIDATE: starts with "sk_test_" AND length > 20
IF length ≤ 20: HARD STOP — "Key too short. Did you paste the full key?"
```

**C1 — `PAYCRAFT_PLAN_[i]_POPULAR` fix** — Step 1.5: Confirm it writes `true`/`false` string (not Y/N):
```
ASK: "Is [plan_name] your most popular plan? [Y/N]"
WRITE: PAYCRAFT_PLAN_[i]_POPULAR=true  (if Y)
       PAYCRAFT_PLAN_[i]_POPULAR=false (if N)
```

---

### 2B — `paycraft-adopt-supabase.md`

**G4 — import_map.json** — Step 2.8: Remove the `--import-map` flag. The webhook uses `https://esm.sh/` URLs directly in the TypeScript source — no import map needed. Supabase CLI handles `esm.sh` imports natively. Update the deploy command:
```
ACTION: supabase functions deploy [provider]-webhook
          --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
          --no-verify-jwt
        (No --import-map flag needed — functions use esm.sh directly)
```

**G13 — Auth check before secrets** — Step 2.9B: Add auth verification before `supabase secrets set`:
```
ACTION: supabase projects list --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN] 2>&1
VERIFY: Exit code 0 (token valid)
IF FAIL: HARD STOP — "Supabase CLI not authenticated.
          Run: supabase login --token [PAYCRAFT_SUPABASE_ACCESS_TOKEN]"
```

**G21 — CLI version check** — Step 2.8 pre-check: Validate version is ≥ 1.50.0:
```
ACTION: supabase --version → parse version number
VERIFY: Major ≥ 1 AND minor ≥ 50 (or major ≥ 2)
IF OUTDATED: HARD STOP — "Supabase CLI [version] is too old.
              Update: brew upgrade supabase/tap/supabase  OR  npm install -g supabase@latest"
```

**C2 — Test email consistency** — Step 2.7: Change test email from `test-verify@paycraft.io` to `e2e-verify@paycraft.io` to match Phase 5. Both phases now use same email.

**C7 — Phase 5.1 query** — Simplify the multi-subquery into separate individual queries (fix is in Phase 5 — see 2F below).

---

### 2C — `paycraft-adopt-stripe.md`

**G7 — Webhook verification must be CRITICAL** — Step 3.6: Replace the soft check with a hard verification using Stripe test helpers:
```
ACTION: mcp__stripe__stripe_api_execute
        POST /v1/test_helpers/test_clocks  (creates test clock — confirms API works)
        OR:
        POST /v1/webhook_endpoints
          → GET webhook endpoint → verify enabled_events includes all 4

VERIFY (mandatory): mcp__stripe__fetch_stripe_resources resource=webhook_endpoints
        → endpoint with url containing "stripe-webhook" exists
        → endpoint.enabled_events includes:
            "checkout.session.completed"
            "customer.subscription.updated"
            "customer.subscription.deleted"
            "invoice.paid"
        → endpoint.status = "enabled"
IF ANY EVENT MISSING:
  HARD STOP: "Webhook endpoint missing required events: [list].
              Open Stripe Dashboard → Webhooks → your endpoint → Edit → add missing events."
OUTPUT: "✓ Webhook endpoint verified: 4 events subscribed, status=enabled"
```

**G22 — Webhook events check now part of G7 fix** (covered above)

**G16 — Quarterly plan interval detection** — Step 3.3: Instead of fragile keyword matching, read `PAYCRAFT_PLAN_[i]_INTERVAL` from .env and map to Stripe interval:
```
READ: PAYCRAFT_PLAN_[i]_INTERVAL from .env (e.g. "/month", "/year", "/3 months")
MAP:
  contains "month" AND NOT "3" → interval=month, interval_count=1
  contains "3" AND contains "month" → interval=month, interval_count=3
  contains "year" → interval=year, interval_count=1
  else → ask user: "How often is [plan_id] billed? [1] Monthly [2] Every 3 months [3] Yearly"
```

**C5 — Progress display** — Step 3 checkpoint: Update orchestrator (paycraft-adopt.md) to read `PAYCRAFT_PROVIDER` when displaying Phase 3 status:
```
Phase 3 [Stripe/Razorpay] Setup  ← show provider name dynamically
```

---

### 2D — `paycraft-adopt-razorpay.md`

No critical gaps. Minor fixes:

**G16** — Same interval detection fix as Stripe (Step 3B.2): Read `PAYCRAFT_PLAN_[i]_INTERVAL` from .env rather than keyword matching on plan ID.

---

### 2E — `paycraft-adopt-client.md`

**G6 — BuildConfig flow** — Reorder Steps 4.5 and 4.8:
- Move key storage question to **before** PayCraft.configure() generation (new Step 4.4B, between 4.4 and 4.5)
- In Step 4.5, write `PayCraft.configure()` using the correct reference:
  - If `local.properties` → write `BuildConfig.SUPABASE_URL` and `BuildConfig.SUPABASE_ANON_KEY`
  - If `Config.kt` → write `Config.SUPABASE_URL` and `Config.SUPABASE_ANON_KEY`
  - If inline (user chose "other") → write literal values with a `// TODO: use constants` comment
- Remove the confusing post-write note "update to use BuildConfig constants"

**G8 — Sonatype API fallback** — Step 4.2:
```
TRY: GET https://central.sonatype.com/api/v1/publisher/search?...
     Parse: latest stable version
IF FAILS OR RESPONSE UNPARSEABLE:
  FALLBACK: Read {paycraft-root}/gradle.properties → extract version= line
  IF NOT FOUND: Ask user "What PayCraft version should I use? (check Maven Central)"
OUTPUT: "Latest PayCraft version: [version] (from [source])"
```

**G9 — BuildConfig integration guidance** — Step 4.8: Add `buildConfigField` snippet when `local.properties` is chosen:
```
DISPLAY after writing local.properties:
  "Add these to your app's build.gradle.kts to read from local.properties:"
  ---
  val localProps = java.util.Properties().apply {
      load(rootProject.file("local.properties").inputStream())
  }
  android {
      buildFeatures { buildConfig = true }
      defaultConfig {
          buildConfigField("String", "SUPABASE_URL",     "\"${localProps["SUPABASE_URL"]}\"")
          buildConfigField("String", "SUPABASE_ANON_KEY","\"${localProps["SUPABASE_ANON_KEY"]}\"")
      }
  }
  ---
```

**G10 — commonMain enforcement** — Step 4.3:
```
CHANGE: "Find shared/build.gradle.kts or common module's build.gradle.kts"
ADD: "IMPORTANT: PayCraft is a KMP library. Add it to commonMain.dependencies ONLY.
      Do NOT add to androidMain, iosMain, or platform-specific modules."
```

**G17 — SettingsScreen detection** — Step 4.7:
```
SEARCH priority:
  1. *Settings*.kt
  2. *Premium*.kt
  3. *Billing*.kt
  4. *Profile*.kt (if named settings-like)
  5. File containing "isPremium" or "isSubscribed" StateFlow usage

IF NONE FOUND:
  ASK: "Which screen shows premium features or billing options?
        Enter the file path relative to [app]:"
```

**C1 — PAYCRAFT_PLAN_[i]_POPULAR in BillingPlan** — Step 4.5: Read POPULAR flag correctly:
```
FOR EACH PLAN i:
  READ: PAYCRAFT_PLAN_[i]_POPULAR (true/false string)
  IF "true": include isPopular = true in BillingPlan()
  IF "false" OR empty: omit isPopular (defaults to false)
```

**C6 — Prerequisite validation** — Prerequisites section: Add provider-specific link check:
```
IF PAYCRAFT_PROVIDER = stripe:
  VERIFY: At least one PAYCRAFT_STRIPE_LINK_* is non-empty
  IF ALL EMPTY: HARD STOP — "No Stripe payment links set. Run /paycraft-adopt-stripe first."
IF PAYCRAFT_PROVIDER = razorpay:
  VERIFY: At least one PAYCRAFT_RAZORPAY_LINK_* is non-empty
  IF ALL EMPTY: HARD STOP — "No Razorpay payment links set. Run /paycraft-adopt-razorpay first."
```

---

### 2F — `paycraft-adopt-verify.md`

**G11 — UTC timestamps** — Step 5.3: Specify UTC explicitly:
```
"current_period_start": "[current UTC time in ISO8601 format — e.g. 2026-04-25T10:00:00Z]"
"current_period_end":   "[30 days from now in UTC — e.g. 2026-05-25T10:00:00Z]"
```
Note: `is_premium()` checks `current_period_end > now()` — both must be UTC for correctness.

**G12 — PLAN_COUNT guard** — Add at start of Step 5.8:
```
READ: PAYCRAFT_PLAN_COUNT from .env
IF EMPTY OR = 0:
  HARD STOP: "PAYCRAFT_PLAN_COUNT not set. Re-run Phase 1 (/paycraft-adopt-env)."
```

**C2 — Test email consistency** — Steps 5.3–5.7: Email already `e2e-verify@paycraft.io` ✓ (no change needed here — fix was in Phase 2.7)

**C3 — Dynamic link key resolution** — Step 5.8:
```
READ: PAYCRAFT_PROVIDER from .env
FOR EACH PLAN:
  IF stripe:   link_key = PAYCRAFT_STRIPE_LINK_[PLAN_ID]
  IF razorpay: link_key = PAYCRAFT_RAZORPAY_LINK_[PLAN_ID]
  READ link_key dynamically (not hardcoded)
```

**C4 — Boolean type check** — Step 5.5:
```
VERIFY: Parse JSON response body
        result = JSON.parse(response_body)
        result === true (boolean, not string "true")
IF result is string "true" (not boolean):
  DISPLAY: "⚠️ RPC returned string 'true' instead of boolean. This is acceptable — some Supabase clients return strings."
  TREAT AS PASS
IF result === false:
  HARD STOP (as before)
```

**C7 — Simplified individual queries** — Step 5.1: Replace single multi-subquery with 4 individual queries:
```
Query 1: SELECT COUNT(*) FROM information_schema.tables WHERE table_name='subscriptions' AND table_schema='public'
         → VERIFY count = 1

Query 2: SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='is_premium' AND routine_schema='public'
         → VERIFY count = 1

Query 3: SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='get_subscription' AND routine_schema='public'
         → VERIFY count = 1

Query 4: SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_name='subscriptions' AND constraint_type='UNIQUE'
         → VERIFY count ≥ 1

FOR EACH QUERY: print result + PASS/FAIL
IF ANY FAIL: HARD STOP with specific "Re-run Phase 2 Step X" instruction
```

**G24 — Gradle daemon** — Step 5.9: Change to `--no-daemon`:
```
ACTION: ./gradlew :shared:compileKotlinMetadata --no-daemon
        (--no-daemon prevents stale JVM state from prior failed builds)
```

---

### 2G — `paycraft-adopt.md` (orchestrator)

**C5 — Progress display** — Update Phase 3 status line:
```
Read PAYCRAFT_PROVIDER from .env
IF stripe:   show "Phase 3 Stripe Setup"
IF razorpay: show "Phase 3 Razorpay Setup"
IF not set:  show "Phase 3 Provider Setup"
```

**C8 — Missing verifications in Phase 4** — Steps 4.2 and 4.4 need explicit success output:
- Step 4.2: `OUTPUT: "✓ Latest PayCraft version: [version]"` (already in file — mark as verify)
- Step 4.4: `VERIFY: File exists at detected path → OUTPUT "✓ Init file: [path]"` (add explicit verify)

---

## GATE 3 — Create Missing Files

### M1 — `server/functions/import_map.json`

**After investigation**: The webhook functions (`stripe-webhook/index.ts`, `razorpay-webhook/index.ts`) use `https://esm.sh/` imports directly — no import map is needed. Supabase Edge Functions resolve these at deploy time.

**Action**: Update Phase 2.8 to remove the `--import-map` reference. **No new file needed.**

### M2 — Sub-command stubs in `.claude/commands/`

Create 6 minimal stub files:

**Files to create** (same pattern for each):

| File | Points to |
|------|-----------|
| `.claude/commands/paycraft-adopt-env.md` | `layers/paycraft/commands/paycraft-adopt-env.md` |
| `.claude/commands/paycraft-adopt-supabase.md` | `layers/paycraft/commands/paycraft-adopt-supabase.md` |
| `.claude/commands/paycraft-adopt-stripe.md` | `layers/paycraft/commands/paycraft-adopt-stripe.md` |
| `.claude/commands/paycraft-adopt-razorpay.md` | `layers/paycraft/commands/paycraft-adopt-razorpay.md` |
| `.claude/commands/paycraft-adopt-client.md` | `layers/paycraft/commands/paycraft-adopt-client.md` |
| `.claude/commands/paycraft-adopt-verify.md` | `layers/paycraft/commands/paycraft-adopt-verify.md` |

**Stub format** (same for all 6):
```markdown
# /[command-name]

[One-line description of the phase]

## Full instructions

See `layers/paycraft/commands/[command-name].md`

## Usage

Standalone: run this phase independently (e.g. to re-run after key rotation).
Full setup: run `/paycraft-adopt` which calls all phases in sequence.
```

---

## GATE 4 — End-to-End Consistency Verification

After all changes are made, verify:

| Check | Pass Criteria |
|-------|--------------|
| `.env.example` has all static + dynamic placeholder keys | Count keys — must have PAYCRAFT_PROVIDER, PLAN_*, STRIPE_TEST_*, RAZORPAY_PLAN_* |
| Phase 1.1 static key list matches `.env.example` (excluding dynamic keys) | Cross-reference key names |
| Phase 1.2 writes `PAYCRAFT_PROVIDER` correctly | Key name matches `.env.example` |
| Phase 1.5 writes `PAYCRAFT_PLAN_[i]_POPULAR` as `true`/`false` | Phase 4.5 reads same format |
| Phase 2.7 and Phase 5.3–5.7 use same test email | Both use `e2e-verify@paycraft.io` |
| Phase 2.8 deploy command has no `--import-map` flag | Grep for `--import-map` → 0 results |
| Phase 3.5 user action gate + Phase 3.6 verify both set the webhook secret | Secret written to .env AND Supabase secrets |
| Phase 4.5 reads `PAYCRAFT_PLAN_[i]_POPULAR` and includes `isPopular=true` in output | Grep for `POPULAR` in Phase 4 file |
| Phase 4 prerequisites check provider-specific link keys | Grep for `HARD STOP.*payment links` |
| Phase 5.1 uses 4 individual queries instead of multi-subquery | File contains 4 separate SELECT COUNT queries |
| Phase 5.3 timestamps have `Z` suffix | Grep for `ISO8601` or `UTC` in Phase 5 |
| Phase 5.8 reads link key dynamically based on PAYCRAFT_PROVIDER | Grep for `PAYCRAFT_PROVIDER` in Step 5.8 |
| All 6 sub-command stubs exist in `.claude/commands/` | `ls .claude/commands/ | grep paycraft-adopt` → 7 files |

---

## Files Modified

| File | Gate | Changes |
|------|------|---------|
| `.env.example` | 1 | Add PAYCRAFT_PROVIDER + PLAN_* + STRIPE_TEST_* + RAZORPAY_PLAN_* sections |
| `layers/paycraft/commands/paycraft-adopt-env.md` | 2A | Split static/dynamic validation, provider recommendation, key length check, POPULAR as true/false |
| `layers/paycraft/commands/paycraft-adopt-supabase.md` | 2B | Remove --import-map, add auth check, add CLI version check, fix test email |
| `layers/paycraft/commands/paycraft-adopt-stripe.md` | 2C | Make Step 3.6 critical + verify 4 webhook events, fix interval detection |
| `layers/paycraft/commands/paycraft-adopt-razorpay.md` | 2D | Fix interval detection |
| `layers/paycraft/commands/paycraft-adopt-client.md` | 2E | Reorder key storage before configure(), BuildConfig guidance, commonMain note, SettingsScreen detection, POPULAR read, prerequisite check |
| `layers/paycraft/commands/paycraft-adopt-verify.md` | 2F | UTC timestamps, PLAN_COUNT guard, dynamic link key, boolean type check, 4 individual queries, --no-daemon |
| `layers/paycraft/commands/paycraft-adopt.md` | 2G | Dynamic Phase 3 label, add missing verify outputs |
| `.claude/commands/paycraft-adopt-env.md` | 3 | **CREATE** stub |
| `.claude/commands/paycraft-adopt-supabase.md` | 3 | **CREATE** stub |
| `.claude/commands/paycraft-adopt-stripe.md` | 3 | **CREATE** stub |
| `.claude/commands/paycraft-adopt-razorpay.md` | 3 | **CREATE** stub |
| `.claude/commands/paycraft-adopt-client.md` | 3 | **CREATE** stub |
| `.claude/commands/paycraft-adopt-verify.md` | 3 | **CREATE** stub |

**Total**: 8 files modified + 6 files created = 14 file operations

---

## Implementation Order

```
Gate 1 → Gate 2 (2A–2G in parallel) → Gate 3 → Gate 4
```

Gates 2A through 2G are independent edits to different files — can be implemented in parallel.
Gate 3 (stubs) depends on nothing — can run in parallel with Gate 2.
Gate 4 (verification) runs last.

---

## Success Criteria

After implementing this plan:
1. `/paycraft-adopt` can be run from scratch with only a fresh `.env` (from `.env.example`) — Phase 1.1 does not hard stop due to missing keys
2. All 6 sub-phases are independently callable as slash commands
3. Webhook deploy command works without `--import-map` (correct for esm.sh-based functions)
4. Phase 3 verifies Stripe webhook events are configured before proceeding
5. Phase 4 writes `PayCraft.configure()` with correct `BuildConfig.X` references from day 1
6. Phase 5 E2E test uses UTC timestamps and correct provider-specific link keys
7. All 33 identified gaps are closed
