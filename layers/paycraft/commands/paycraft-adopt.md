# /paycraft-adopt — PayCraft Adoption Host

> **MATRIX HOST** — Shows live implementation status, then routes to phase commands.
> Every action is handled by a dedicated phase file. This file owns only the matrix and menu.

---

## ⚠️ STRICTLY ENFORCED: KMP-FIRST — NO PLATFORM-SPECIFIC BILLING CODE

PayCraft is a **Kotlin Multiplatform library**. Every integration MUST target `commonMain`.
The ONLY allowed platform-specific code: `PayCraftPlatform.init()` in `androidMain` / `iosMain`.
Everything else — `PayCraft.configure()`, `PayCraftBanner`, `LifecycleEventEffect` refresh — goes in `commonMain`.
**HARD STOP** on any `subscriptionManager.refreshStatus()` in `Activity.onResume()` or any Activity/AppDelegate.

---

## MEMORY SYSTEM — `.paycraft/memory.json` Schema (M1)

```json
{
  "paycraft_version": "1.1.0",
  "last_run": "2026-04-26T09:35:49Z",
  "env_path": "/path/to/project/.env",
  "env_path_confirmed_by_user": true,
  "koin_module_file": "cmp-navigation/src/commonMain/.../KoinModules.kt",
  "koin_module_line": 42,
  "billing_card_file": "feature/settings/src/commonMain/.../SettingsScreen.kt",
  "billing_card_line": 557,
  "lifecycle_refresh_file": "feature/settings/src/commonMain/.../SettingsScreen.kt",
  "lifecycle_refresh_line": 152,
  "configure_file": "core/network/src/commonMain/.../NetworkModule.kt",
  "deep_link_scheme": "myapp",
  "phases_completed": ["env", "supabase", "stripe", "client"],
  "phases_verified": ["supabase", "client", "sandbox_e2e", "production_ready"],
  "supabase_project_ref": "mlwfgytjxlqyfxcgpysm",
  "stripe_product_id": "prod_...",
  "stripe_live_product_id": "prod_... (live)",
  "payment_links": {
    "monthly": "https://buy.stripe.com/test_...",
    "yearly": "https://buy.stripe.com/test_..."
  },
  "payment_links_live": {
    "monthly": "https://buy.stripe.com/...",
    "yearly": "https://buy.stripe.com/..."
  }
}
```

**Rules:**
- Written atomically: always write to `.paycraft/memory.json.tmp` then rename (S10)
- Read BEFORE every run — see STEP 0A
- Supplements live scanning (matrix always re-checks live state)
- `.paycraft/backups/` and `.paycraft/exports/` are gitignored (secrets)
- All other `.paycraft/` files are safe to commit

---

## STEP 0A — READ MEMORY + SCHEMA MIGRATION (runs before matrix)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
SCHEMA_PATH = {TARGET_APP_PATH}/.paycraft/schema_version

IF memory.json exists:
  READ + PARSE → populate remembered_context (env_path, koin_module_file, etc.)

  READ SCHEMA_PATH → stored_version
  CURRENT_VERSION = current PayCraft library version
  IF stored_version != CURRENT_VERSION:
    DISPLAY:
      "⚠️  PayCraft version change detected: {stored_version} → {CURRENT_VERSION}"
      "[U] Update memory schema automatically   [S] Skip (keep old schema)"
    IF [U]: update schema, write schema_version, write memory.json

ELSE:
  remembered_context = {} (cold start)
  OUTPUT: "ℹ First run — .paycraft/ will be initialized in Phase 1"
```

---

## STEP 0 — STATUS MATRIX (runs FIRST, every time)

Before executing anything, read memory (STEP 0A above), then scan live state and display this matrix.
Memory-remembered values show `[✓ remembered]` in the matrix:

```
╔══ /paycraft-adopt — Current Implementation Status ════════════════════════════╗
║                                                                                 ║
║  ENVIRONMENT (.env)                                                             ║
║  [✓/✗] PAYCRAFT_SUPABASE_PROJECT_REF  — [value or MISSING]                    ║
║  [✓/✗] PAYCRAFT_SUPABASE_URL          — [value or MISSING]                    ║
║  [✓/✗] PAYCRAFT_SUPABASE_ANON_KEY     — [set/MISSING]                         ║
║  [✓/✗] PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY — [set/MISSING]                     ║
║  [✓/✗] PAYCRAFT_PROVIDER              — [stripe/razorpay/MISSING]              ║
║  [✓/✗] PAYCRAFT_MODE                  — [test/live/MISSING]                    ║
║                                                                                 ║
║  STRIPE TEST                                                                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_SECRET_KEY     — [sk_test_.../MISSING]            ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET — [set/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_MONTHLY   — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_QUARTERLY — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_YEARLY    — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_PORTAL_URL     — [url/MISSING]                    ║
║                                                                                 ║
║  STRIPE LIVE                                                                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_SECRET_KEY     — [sk_live_.../MISSING]            ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET — [set/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY   — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_QUARTERLY — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_YEARLY    — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_PORTAL_URL     — [url/MISSING]                    ║
║                                                                                 ║
║  SUPABASE                                                                       ║
║  [?] subscriptions table              — [✓ exists / ✗ missing / ? not checked] ║
║  [?] is_premium() RPC                 — [✓ exists / ✗ missing / ? not checked] ║
║  [?] get_subscription() RPC           — [✓ exists / ✗ missing / ? not checked] ║
║  [?] stripe-webhook function              — [✓ ACTIVE / ✗ missing / ? not checked] ║
║  [?] STRIPE_TEST_SECRET_KEY deployed      — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_TEST_WEBHOOK_SECRET deployed  — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_LIVE_SECRET_KEY deployed      — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_LIVE_WEBHOOK_SECRET deployed  — [✓ set / ✗ missing / ? not checked]    ║
║                                                                                 ║
║  CLIENT APP ([target_app_path])                                                 ║
║  [?] PayCraft dependency in Gradle    — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraft.configure() call        — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraftModule in Koin           — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraftBanner in SettingsScreen — [✓ found / ✗ missing / ? not checked]  ║
║  [?] LifecycleEventEffect ON_RESUME   — [✓ found / ✗ missing / ? not checked]  ║
║  [?] iOS cocoapods declared           — [✓ found / ✗ missing / ? not checked]  ║
║                                                                                 ║
║  MEMORY (.paycraft/memory.json)                                                 ║
║  [?] .paycraft/ initialized           — [✓ exists / ✗ not yet]                 ║
║  [?] env_path remembered              — [✓ {path} / ✗ not set]                 ║
║  [?] koin_module_file remembered      — [✓ {file}:{line} / ✗ not set]          ║
║  [?] billing_card_file remembered     — [✓ {file}:{line} / ✗ not set]          ║
║  [?] phases_completed                 — [list or NONE]                          ║
║                                                                                 ║
║  SANDBOX TEST (last run)                                                        ║
║  [?] Sandbox payment completed        — [✓ verified {date} / ✗ not run]        ║
║                                         (source: .paycraft/test_results/       ║
║                                          sandbox_test.json)                    ║
║  [?] Webhook received + DB updated    — [✓ verified / ✗ not run]               ║
║  [?] is_premium() confirmed true      — [✓ verified / ✗ not run]               ║
║                                                                                 ║
║  LIVE MODE                                                                      ║
║  [?] PAYCRAFT_STRIPE_LIVE_SECRET_KEY  — [sk_live_.../MISSING]                  ║
║  [?] PAYCRAFT_STRIPE_LIVE_LINK_*      — [all set / partial / MISSING]          ║
║  [?] Live webhook registered          — [✓ / ✗ / ? not checked]                ║
║  [?] Live E2E test completed          — [✓ / ✗ not run]                        ║
║                                                                                 ║
║  PRODUCTION READINESS (.paycraft/production_ready.json)                         ║
║  [?] All gates passed (PR.1–PR.7)     — [✓ certified {date} / ✗ not run]      ║
║  [?] Certification age                — [✓ recent / ⚠ {N} days ago / ✗ none]  ║
║  [?] Env changed since certification  — [✓ unchanged / ⚠ changed — re-run P]  ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

### HOW TO POPULATE THE MATRIX

**ENV section**: Read {ENV_PATH} — check each PAYCRAFT_* key.
  Show actual value for non-secret keys (URL, REF, PROVIDER, MODE, LINK_*).
  Show `[set]` / `[MISSING]` for secrets (keys containing sk_, whsec_, JWT token patterns).

**SUPABASE section**: Only query if ENV keys present.
  1. POST database/query: `SELECT COUNT(*) FROM information_schema.tables WHERE table_name='subscriptions'`
  2. POST database/query: `SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='is_premium'`
  3. POST database/query: `SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='get_subscription'`
  4. GET `https://api.supabase.com/v1/projects/{ref}/functions` → check stripe-webhook status
  AUTH: Bearer PAYCRAFT_SUPABASE_ACCESS_TOKEN
  If ENV keys missing → show `? not checked` for all.

**CLIENT APP section**: Only scan if target_app_path is known.
  Note: KMP projects are often multi-module — search ALL subdirs, not just src/commonMain.
  1. Glob `**/libs.versions.toml` → grep `paycraft`
  2. Grep `{target_app_path}/**/*.kt` for `PayCraft.configure(`
  3. Grep `{target_app_path}/**/*.kt` for `PayCraftModule`
  4. Grep `{target_app_path}/**/commonMain/**/*.kt` for `PayCraftBanner`
  5. Grep `{target_app_path}/**/commonMain/**/*.kt` for `LifecycleEventEffect`
  6. Grep `{target_app_path}/**/build.gradle.kts` for `kotlinCocoapods`

**MEMORY section**: Read `.paycraft/memory.json` → show remembered_context fields.
**SANDBOX / LIVE TEST section**: Read `.paycraft/test_results/sandbox_test.json` and `live_test.json`.
**PRODUCTION READINESS section**: Read `.paycraft/production_ready.json` if it exists.
  - `certified_at` present → show `[✓ certified {date}]`
  - `certified_at` > 30 days ago → show `[⚠ certified {N} days ago — consider re-running [P]]`
  - Compare env keys to `certified_at` timestamp → if any PAYCRAFT_* key modified after that date → show `[⚠ env changed since certification]`
  - File missing → show `[✗ not run — run [P] before shipping]`

After matrix, display action menu:

```
╔══ What would you like to do? ══════════════════════════════════════════════════╗
║                                                                                 ║
║  [A] Run full setup      — Phases 1→5 (skip phases already showing all ✓)     ║
║  [B] Test sandbox        — API + device logcat, IS_TEST_MODE=true (Phase 5B)   ║
║  [C] Test live           — Real card + device logcat, IS_TEST_MODE=false (5C)  ║
║  [D] Keys guide          — Step-by-step: how to get every key/secret           ║
║  [E] Verify only         — Re-run Phase 5 API checks (no writes)               ║
║  [F] Fix specific phase  — Pick a phase to re-run                              ║
║  [P] Production ready    — Run all 7 gates, certify, save to .paycraft/        ║
║  [X] Clean up test data  — Delete mode='test' rows from subscriptions table    ║
║  [Q] Quit                                                                       ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

**Routes:**
- [A] → STEP 0B bootstrap → load and run Phase 1–5 in sequence (smart-skip complete phases)
- [B] → load `layers/paycraft/commands/paycraft-adopt-sandbox.md` → run Phase 5B
- [C] → load `layers/paycraft/commands/paycraft-adopt-live.md` → run Phase 5C
- [D] → load `layers/paycraft/commands/paycraft-adopt-keys.md` → display keys guide
- [E] → load `layers/paycraft/commands/paycraft-adopt-verify.md` → run Phase 5
- [F] → ask which phase (1–5) → load that file → run it
- [P] → load `layers/paycraft/commands/paycraft-adopt-production.md` → run production readiness check
- [X] → inline cleanup: query count WHERE mode='test', confirm, DELETE WHERE mode='test', show result
- [Q] → exit

**[X] Clean up test data — inline logic:**
```
1. GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?mode=eq.test&select=email,plan,updated_at
   Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

2. IF count = 0:
     DISPLAY: "✓ No test subscriptions found — table is clean."
     → return to menu

3. DISPLAY table of test rows (email, plan, updated_at)
   DISPLAY:
   "⚠️  Found [N] test subscription(s) with mode='test'."
   "These were created using sk_test_ Stripe keys."
   "Deleting removes them from DB but NOT from Stripe Dashboard."
   ""
   "[D] Delete all [N] test rows   [K] Keep (cancel)"

4. IF [D]:
     DELETE {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?mode=eq.test
     Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
     Prefer: return=minimal

     VERIFY: GET count again → expect 0
     DISPLAY: "✓ Deleted [N] test row(s). Table now has [M] live row(s)."

5. Re-render status matrix with updated state.
```

---

## STEP 0B — BOOTSTRAP (auto-resolve paths before any phase)

### Resolve PAYCRAFT_ROOT

```
FRAMEWORK_ROOT = working directory of Claude Code session
STANDARD_LOCATION = {FRAMEWORK_ROOT}/workspaces/mbs/PayCraft

CHECK: {STANDARD_LOCATION}/server/migrations/001_create_subscriptions.sql exists?
IF YES: paycraft_root = {STANDARD_LOCATION}
IF NOT:
  CHECK: {FRAMEWORK_ROOT}/.env → PAYCRAFT_ROOT key
  IF SET AND valid: paycraft_root = {PAYCRAFT_ROOT value}
  ELSE:
    DISPLAY options: [1] Clone  [2] Enter path
    IF [1]: git clone https://github.com/mobilebytelabs/paycraft {FRAMEWORK_ROOT}/workspaces/mbs/PayCraft
    IF [2]: ASK path → validate migrations/ exists
OUTPUT: "✓ PayCraft: {paycraft_root}"
```

### Resolve TARGET_APP from session context

```
READ: {FRAMEWORK_ROOT}/.claude-runtime/scratchpad/SESSION_CONTEXT_*.md (most recent)
EXTRACT: active_project field (e.g. "mbs/reels-downloader")
DERIVE: target_app_path = {FRAMEWORK_ROOT}/workspaces/{active_project}/source/{project_name}/
CHECK: contains libs.versions.toml or build.gradle.kts?
IF YES: confirm with user "[Y] Use this / [N] Different app"
IF NOT FOUND: ASK for path → validate → resolve

OUTPUT: "✓ Target app: {target_app_path}"
```

### Derive ENV_PATH

```
IF target_app_path contains "/source/":
  ENV_PATH = everything before "/source/" + "/.env"
ELSE:
  ENV_PATH = target_app_path + "/.env"

IF not exists: create with PAYCRAFT_* template
ELSE IF missing PAYCRAFT_PROVIDER=: append PAYCRAFT_* block

OUTPUT: "✓ .env: {ENV_PATH}"
```

After paths resolved → run STEP 0 STATUS MATRIX → display action menu.

---

## Phase Runtime Files

| Phase | File | Purpose |
|-------|------|---------|
| Phase 1 | `layers/paycraft/commands/paycraft-adopt-env.md` | ENV bootstrap + key validation |
| Phase 2 | `layers/paycraft/commands/paycraft-adopt-supabase.md` | Supabase migrations + webhook |
| Phase 3 (Stripe) | `layers/paycraft/commands/paycraft-adopt-stripe.md` | Stripe products + payment links |
| Phase 3B (Razorpay) | `layers/paycraft/commands/paycraft-adopt-razorpay.md` | Razorpay payment links |
| Phase 4 | `layers/paycraft/commands/paycraft-adopt-client.md` | KMP client integration |
| Phase 5 | `layers/paycraft/commands/paycraft-adopt-verify.md` | E2E API verification |
| Phase 5B | `layers/paycraft/commands/paycraft-adopt-sandbox.md` | Sandbox test (test card + device logs) |
| Phase 5C | `layers/paycraft/commands/paycraft-adopt-live.md` | Live test (real card + device logs) |
| Keys guide | `layers/paycraft/commands/paycraft-adopt-keys.md` | How to get every key |
| Production | `layers/paycraft/commands/paycraft-adopt-production.md` | 7-gate production readiness check + certification |

### Phase progress display (during [A] full setup)

```
╔══ /paycraft-adopt ════════════════════════════════════════╗
║  Phase 1 ENV Bootstrap      [✓ Complete]                  ║
║  Phase 2 Supabase Setup     [⏳ Running: Step 2.3/9]      ║
║  Phase 3 Stripe Setup       [⬜ Pending]                  ║
║  Phase 4 Client Integration [⬜ Pending]                  ║
║  Phase 5 Verification       [⬜ Pending]                  ║
║  Phase 5B Sandbox Test      [⬜ Pending]                  ║
║  Phase 5C Live Test         [⬜ Pending]                  ║
║  Phase P  Production Ready  [⬜ Pending]                  ║
╚══════════════════════════════════════════════════════════╝
```

### Smart skip (matrix-informed)

If matrix shows all ✓ for a phase:
```
"Phase 2 (Supabase) appears complete — all checks pass."
"[S] Skip   [R] Re-run anyway"
```

### Progress file (resumption)

```
PROGRESS_FILE = {target_app_path}/.paycraft/setup_progress.json
WRITE after each phase: { "completed_phases": [...], "target_app": "...", "last_updated": "..." }
ON START if exists: "[R] Resume from Phase [N]  [S] Start over  [Q] Quit"
```

---

## Enforcement Rules (STRICTLY ENFORCED)

1. **STRICT SEQUENCE**: Phase 1→2→3→4→5→5B→5C→P. Phase 5C requires 5B PASS first. Phase P requires 5B + 5C PASS.
2. **VERIFY AFTER EVERY ACTION**: Every API call, migration, deploy = immediate verify. Fail = HARD STOP.
3. **KMP-FIRST**: Zero platform-specific billing code. All PayCraft calls in `commonMain`.
4. **USER ACTION GATES**: Browser steps → numbered checklist + exact URL → PAUSE → verify.
5. **TEST BEFORE LIVE**: Phase 5B (sandbox) MUST PASS before Phase 3 live or Phase 5C.
6. **HARD STOP FORMAT**:
   ```
   ✗ HARD STOP — [step] failed
   Reason: [exact error]
   Fix   : [numbered steps]
   Run this step again after fixing.
   ```
7. **PHASE CHECKPOINTS**: Summary at end of every phase. User confirms before next.
