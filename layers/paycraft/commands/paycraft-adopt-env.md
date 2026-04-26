# paycraft-adopt-env — Phase 1: ENV Bootstrap

> **PHASE 1 of 5** — Sets up `.env`, initializes `.paycraft/` memory directory, and validates all credentials.
> All steps run in strict sequence. Every step verifies its result.
> A single missing or invalid key is a HARD STOP.

---

## Phase 1 Steps

### STEP 1.0 — Read .paycraft/memory.json (if exists)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json

IF memory.json EXISTS:
  READ: Parse JSON → extract env_path, env_path_confirmed_by_user, phases_completed[]
  IF env_path_confirmed_by_user = true:
    ENV_PATH = {memory.json env_path}
    OUTPUT: "ℹ Remembered .env location: {ENV_PATH}"
    SKIP Step 1.0A (env location picker) — go directly to Step 1.1
  ELSE:
    proceed to Step 1.0A

IF memory.json DOES NOT EXIST:
  proceed to Step 1.0A (first run)

IF $CI = true (CI environment):
  ENV_PATH = pre-set value from bootstrap stub
  OUTPUT: "ℹ CI mode: using ENV_PATH from environment ({ENV_PATH})"
  SKIP Step 1.0A
```

### STEP 1.0A — Ask .env location (first run only, not CI)

```
╔══ Where should PayCraft store your credentials (.env)? ═══════════════╗
║                                                                          ║
║  PayCraft needs to store API keys (Supabase, Stripe, Razorpay).        ║
║  These are secrets — NEVER committed to git.                           ║
║                                                                          ║
║  [A] {TARGET_APP_PATH}/.env         ← recommended (standard location)  ║
║      gitignore entry: /.env                                            ║
║  [B] {TARGET_APP_PATH}/../.env      ← workspace root (outside source) ║
║      gitignore entry: ../.env                                          ║
║  [C] Enter a custom path                                               ║
║                                                                          ║
║  Default: [A] — press Enter to accept                                  ║
╚══════════════════════════════════════════════════════════════════════════╝

WAIT: user picks A/B/C or presses Enter (default = A)
RESOLVE:
  A or Enter → ENV_PATH = {TARGET_APP_PATH}/.env
               GITIGNORE_PATH = {TARGET_APP_PATH}/.gitignore
               GITIGNORE_ENTRY = /.env
  B           → ENV_PATH = {TARGET_APP_PATH}/../.env
               GITIGNORE_PATH = {TARGET_APP_PATH}/../.gitignore
               GITIGNORE_ENTRY = .env
  C           → ASK: "Enter full path to your .env file:"
               ENV_PATH = {entered path}
               GITIGNORE_PATH = {dirname(ENV_PATH)}/.gitignore
               GITIGNORE_ENTRY = /{basename(ENV_PATH)}

OUTPUT: "✓ .env location: {ENV_PATH}"

--- Auto-add to .gitignore ---
CHECK: Does {GITIGNORE_PATH} contain {GITIGNORE_ENTRY}?
IF NOT: Append {GITIGNORE_ENTRY} to {GITIGNORE_PATH}
        OUTPUT: "✓ Added {GITIGNORE_ENTRY} to {GITIGNORE_PATH}"
ELSE:   OUTPUT: "✓ .gitignore already has {GITIGNORE_ENTRY}"
```

### STEP 1.0B — Initialize .paycraft/ directory structure

```
BASE = {TARGET_APP_PATH}/.paycraft/

CREATE (if not exists):
  {BASE}                          ← main directory
  {BASE}supabase/migrations/      ← SQL copies deployed to this project
  {BASE}supabase/functions/       ← Edge Function source copies
  {BASE}test_results/             ← sandbox + live test results
  {BASE}backups/                  ← .env snapshots (gitignored)

WRITE: {BASE}schema_version → current PayCraft version (e.g. "1.1.0")
       (If file exists and version differs → show migration prompt — see M4)

--- Auto-update consumer .gitignore ---
GITIGNORE = {TARGET_APP_PATH}/.gitignore
ENTRIES_NEEDED:
  ".paycraft/backups/"
  ".paycraft/exports/"
FOR EACH entry:
  IF NOT in {GITIGNORE}: append entry
OUTPUT: "✓ .paycraft/ initialized ({BASE})"
OUTPUT: "✓ .paycraft/backups/ and .paycraft/exports/ added to .gitignore"
```

### STEP 1.1 — Check .env file exists

```
NOTE: ENV_PATH was resolved in Step 1.0 or 1.0A.
      It points to the ADOPTING PROJECT's .env, not the PayCraft library directory.
      Example (framework): workspaces/mbs/reels-downloader/.env
      Example (open source): /Users/them/my-kmp-app/.env
      All reads/writes in this phase use ENV_PATH.

ACTION  : test -f {ENV_PATH}
IF NOT EXISTS:
  ACTION  : Create {ENV_PATH} with PAYCRAFT_* key block
            (copy PAYCRAFT_* sections from {paycraft_root}/.env.example)
  DISPLAY : "Created {ENV_PATH} with PayCraft key template"
IF EXISTS AND missing PAYCRAFT_PROVIDER= line:
  ACTION  : Append PAYCRAFT_* key block to {ENV_PATH}
  DISPLAY : "Appended PAYCRAFT_* keys to existing {ENV_PATH}"

VERIFY  : Read .env → confirm STATIC PAYCRAFT_ keys are present as lines
          (empty values OK — existence check only, missing KEY LINE = HARD STOP)

  STATIC KEYS (must be present as lines in .env — provider-agnostic structure):
    PAYCRAFT_MODE,
    PAYCRAFT_SUPABASE_URL, PAYCRAFT_SUPABASE_PROJECT_REF,
    PAYCRAFT_SUPABASE_ANON_KEY, PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY,
    PAYCRAFT_SUPABASE_ACCESS_TOKEN,
    PAYCRAFT_STRIPE_TEST_SECRET_KEY, PAYCRAFT_STRIPE_TEST_PUBLISHABLE_KEY,
    PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET, PAYCRAFT_STRIPE_TEST_PORTAL_URL,
    PAYCRAFT_STRIPE_LIVE_SECRET_KEY, PAYCRAFT_STRIPE_LIVE_PUBLISHABLE_KEY,
    PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET, PAYCRAFT_STRIPE_LIVE_PORTAL_URL,
    PAYCRAFT_RAZORPAY_KEY_ID, PAYCRAFT_RAZORPAY_KEY_SECRET,
    PAYCRAFT_RAZORPAY_WEBHOOK_SECRET,
    PAYCRAFT_SUPPORT_EMAIL, PAYCRAFT_CURRENCY, PAYCRAFT_APP_REDIRECT_URL,
    PAYCRAFT_PROVIDER, PAYCRAFT_PLAN_COUNT,
    PAYCRAFT_PLAN_1_ID, PAYCRAFT_PLAN_1_NAME,
    PAYCRAFT_PLAN_1_PRICE, PAYCRAFT_PLAN_1_INTERVAL, PAYCRAFT_PLAN_1_POPULAR

  DYNAMIC KEYS (skip existence check — written later by Phase 1.5, Phases 3/3B):
    PAYCRAFT_PLAN_2_*, PAYCRAFT_PLAN_3_*, PAYCRAFT_PLAN_4_* ...  ← written by Step 1.5 based on plan count
    PAYCRAFT_STRIPE_TEST_LINK_*, PAYCRAFT_STRIPE_LIVE_LINK_*     ← key name depends on user's plan IDs
    PAYCRAFT_RAZORPAY_LINK_*                                      ← key name depends on user's plan IDs
    PAYCRAFT_STRIPE_TEST_PRODUCT_ID, PAYCRAFT_STRIPE_TEST_PRICE_*
    PAYCRAFT_STRIPE_LIVE_PRODUCT_ID, PAYCRAFT_STRIPE_LIVE_PRICE_*
    PAYCRAFT_RAZORPAY_PLAN_*

IF ANY STATIC KEY LINE MISSING FROM FILE:
  HARD STOP: ".env is missing key [KEY_NAME]. Was .env.example modified?
              Fix: cp .env.example .env and re-run."

COUNT: total lines matching PAYCRAFT_= pattern
COUNT_EMPTY: lines where value after = is empty string
OUTPUT  : "✓ .env ready — [N] keys present, [M] empty (will be filled during setup)"
```

### STEP 1.2 — Ask provider choice

```
CHECK   : Read PAYCRAFT_PROVIDER from .env
IF EMPTY OR NOT IN [stripe, razorpay]:
  DISPLAY : "Which payment provider will you use?"
            "[1] Stripe   (recommended — Stripe MCP support for automatic setup)"
            "[2] Razorpay (manual API calls — MCP not available)"
  WAIT    : user selects
  ACTION  : Write PAYCRAFT_PROVIDER=[choice] to .env
VERIFY  : Re-read .env → PAYCRAFT_PROVIDER is exactly "stripe" or "razorpay"
IF VERIFY FAILS:
  HARD STOP: "PAYCRAFT_PROVIDER write failed. Check .env file permissions."
OUTPUT  : "✓ Provider: [stripe/razorpay]"
```

### STEP 1.3 — Collect Supabase credentials

```
NOTE: Strip leading/trailing whitespace from ALL pasted values before validation.
      Keys copied from dashboards often include a trailing newline or space.

REQUIRED KEYS (collect in this order):
  1. PAYCRAFT_SUPABASE_PROJECT_REF
     IF EMPTY:
       USER ACTION GATE:
         "Get your Supabase project ref:"
         "1. Open: https://supabase.com/dashboard"
         "2. Select your project"
         "3. The ref is the string in the URL after /project/"
         "   Example: https://supabase.com/dashboard/project/abcdefghij → ref = abcdefghij"
         "Paste your project ref here:"
       VALIDATE : matches pattern [a-z]{20} (20 lowercase chars)
       IF INVALID : HARD STOP — "Invalid project ref format. Should be 20 lowercase letters."
       WRITE    : PAYCRAFT_SUPABASE_PROJECT_REF=[value] to .env

  2. PAYCRAFT_SUPABASE_URL
     IF EMPTY:
       ACTION   : Derive from ref: https://[PAYCRAFT_SUPABASE_PROJECT_REF].supabase.co
       WRITE    : PAYCRAFT_SUPABASE_URL to .env
       DISPLAY  : "Auto-derived PAYCRAFT_SUPABASE_URL from project ref"

  3. PAYCRAFT_SUPABASE_ANON_KEY
     IF EMPTY:
       USER ACTION GATE:
         "Get your Supabase anon key:"
         "1. Open: https://supabase.com/dashboard/project/[ref]/settings/api"
         "2. Under 'Project API keys', find 'anon public'"
         "3. Click 'Copy' next to the anon key (starts with eyJ...)"
         "Paste here:"
       VALIDATE : starts with "eyJ"
       IF INVALID : HARD STOP — "Invalid anon key. Should start with eyJ"
       WRITE    : PAYCRAFT_SUPABASE_ANON_KEY to .env

  4. PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY
     IF EMPTY:
       USER ACTION GATE:
         "Get your Supabase service role key:"
         "1. Open: https://supabase.com/dashboard/project/[ref]/settings/api"
         "2. Under 'Project API keys', find 'service_role'"
         "3. Click 'Reveal' then 'Copy' (starts with eyJ...)"
         "⚠️  WARNING: Never expose this key in client apps or git"
         "Paste here:"
       VALIDATE : starts with "eyJ" AND is different from ANON_KEY
       IF SAME AS ANON : HARD STOP — "Service role key must be different from anon key."
       WRITE    : PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY to .env

  5. PAYCRAFT_SUPABASE_ACCESS_TOKEN
     IF EMPTY:
       USER ACTION GATE:
         "Get your Supabase personal access token (for CLI):"
         "1. Open: https://supabase.com/dashboard/account/tokens"
         "2. Click 'Generate new token'"
         "3. Name: 'paycraft-setup' (or any name)"
         "4. Copy the token (starts with sbp_...)"
         "Paste here:"
       VALIDATE : starts with "sbp_"
       IF INVALID : HARD STOP — "Invalid access token. Should start with sbp_"
       WRITE    : PAYCRAFT_SUPABASE_ACCESS_TOKEN to .env

FINAL VERIFY: Re-read .env → all 5 Supabase keys present and non-empty
IF ANY EMPTY : HARD STOP — "[KEY] still empty after collection."
OUTPUT : "✓ Supabase credentials complete (5 keys)"
```

### STEP 1.4 — Collect provider credentials

```
READ: PAYCRAFT_PROVIDER from .env

[IF STRIPE]

  --- 1.4A: TEST mode key (REQUIRED for Phase 3 setup) ---

  CHECK: PAYCRAFT_STRIPE_TEST_SECRET_KEY
  IF EMPTY OR NOT starts with "sk_test_":
    USER ACTION GATE:
      "Get your Stripe TEST secret key:"
      "1. Open: https://dashboard.stripe.com/test/apikeys"
      "   (Enable 'Test mode' toggle in top-right of Stripe Dashboard)"
      "2. Under 'Secret key', click 'Reveal test key'"
      "3. Copy the key (starts with sk_test_...)"
      "Paste here:"
    STRIP   : Remove leading/trailing whitespace from pasted value
    VALIDATE : starts with "sk_test_"
    IF starts with "sk_live_":
      HARD STOP: "LIVE Stripe key detected.
                  PAYCRAFT_STRIPE_TEST_SECRET_KEY must be sk_test_...
                  Switch Stripe Dashboard to Test mode and get the test key."
    IF NOT starts with "sk_":
      HARD STOP: "Invalid Stripe key format. Must start with sk_test_"
    VALIDATE : length > 20
    IF length ≤ 20:
      HARD STOP: "Stripe key too short (length=[length]).
                  The complete sk_test_ key is typically 100+ characters."
    WRITE : PAYCRAFT_STRIPE_TEST_SECRET_KEY to .env
  VERIFY: re-read → key starts with "sk_test_" AND length > 20
  OUTPUT : "✓ Stripe TEST secret key set (PAYCRAFT_STRIPE_TEST_SECRET_KEY)"

  --- 1.4B: LIVE mode key (OPTIONAL — fill now or fill before going live) ---

  CHECK: PAYCRAFT_STRIPE_LIVE_SECRET_KEY
  IF EMPTY:
    DISPLAY:
      "Do you want to add your Stripe LIVE secret key now? (optional — can be added before launch)"
      "Get it at: https://dashboard.stripe.com/apikeys  (Test mode toggle OFF)"
      "[Y] Paste live key now   [N] Skip — I'll add it before launch"
    IF [Y]:
      ASK: "Paste PAYCRAFT_STRIPE_LIVE_SECRET_KEY (starts with sk_live_):"
      STRIP : Remove leading/trailing whitespace
      VALIDATE : starts with "sk_live_"
      IF NOT:
        DISPLAY: "⚠️  Not a live key — skipping. Add PAYCRAFT_STRIPE_LIVE_SECRET_KEY manually before launch."
        → skip write
      ELSE:
        VALIDATE : length > 20
        WRITE : PAYCRAFT_STRIPE_LIVE_SECRET_KEY to .env
        OUTPUT: "✓ Stripe LIVE secret key set (PAYCRAFT_STRIPE_LIVE_SECRET_KEY)"
    IF [N]:
      DISPLAY: "Skipped. Fill PAYCRAFT_STRIPE_LIVE_SECRET_KEY in .env before running Phase 3 live setup."

  --- 1.4C: Mode selection ---

  DISPLAY:
    "Which mode should be active? (can be changed any time in .env)"
    "[1] test — development mode, no real charges (recommended to start)"
    "[2] live — production mode, real charges"
  WAIT: user picks
  WRITE: PAYCRAFT_MODE=test (if [1]) or PAYCRAFT_MODE=live (if [2]) to .env
  OUTPUT: "✓ PAYCRAFT_MODE=[mode] set"

[IF RAZORPAY]
  CHECK: PAYCRAFT_RAZORPAY_KEY_ID and PAYCRAFT_RAZORPAY_KEY_SECRET
  FOR EACH MISSING:
    USER ACTION GATE:
      "Get your Razorpay API credentials (Test mode):"
      "1. Open: https://dashboard.razorpay.com/app/keys"
      "   (Select 'Test' from the mode toggle)"
      "2. Copy Key ID (starts with rzp_test_...)"
      "   Paste here:"
    VALIDATE KEY_ID: starts with "rzp_test_" or "rzp_live_"
      "3. Copy Key Secret"
      "   Paste here:"
    WRITE both to .env
  WRITE: PAYCRAFT_MODE=test to .env
  VERIFY: both present in .env
  OUTPUT : "✓ Razorpay credentials set"
```

### STEP 1.5 — Collect currency + plan definitions

```
CHECK   : PAYCRAFT_CURRENCY in .env
IF EMPTY:
  DISPLAY : "What currency will you charge in?"
            "[1] INR — Indian Rupee (₹)"
            "[2] USD — US Dollar ($)"
            "[3] EUR — Euro (€)"
            "[4] GBP — British Pound (£)"
            "[5] Other — enter ISO code"
  WRITE   : PAYCRAFT_CURRENCY to .env

DISPLAY : "How many subscription plans? (press Enter for 2 — monthly + yearly)"
READ    : N (default 2)
VALIDATE: N ≥ 1
IF N = 0:
  HARD STOP: "Plan count must be at least 1. Enter a number ≥ 1."

FOR EACH PLAN i = 1..N:
  DISPLAY : "Plan [i] of [N]:"
  ASK     : Plan ID (e.g. monthly, quarterly, yearly)
  SANITIZE: Replace any spaces, hyphens, or special chars with underscore
            Convert to lowercase
            VALIDATE: result matches [a-z0-9_]+ (letters, digits, underscore only)
            IF INVALID after sanitize: HARD STOP — "Plan ID can only contain letters, digits, underscore."
            STORE → PAYCRAFT_PLAN_[i]_ID

  ASK     : Display name (e.g. Monthly, Quarterly, Yearly) → PAYCRAFT_PLAN_[i]_NAME
  ASK     : Price in minor units (e.g. 999 = ₹9.99 or $9.99) → PAYCRAFT_PLAN_[i]_PRICE
  VALIDATE: PRICE is a positive integer
  IF NOT INTEGER OR ≤ 0: HARD STOP — "Price must be a positive integer in minor units (e.g. 999 for ₹9.99)"

  ASK     : Billing interval label (e.g. /month, /year) → PAYCRAFT_PLAN_[i]_INTERVAL
  ASK     : "Is [plan_name] your most popular/highlighted plan? [Y/N]"
  WRITE   : PAYCRAFT_PLAN_[i]_POPULAR=true  (if Y)
            PAYCRAFT_PLAN_[i]_POPULAR=false (if N)
            (Write lowercase "true"/"false" string — NOT Y/N)
  WRITE   : All 5 keys to .env

WRITE   : PAYCRAFT_PLAN_COUNT=[N] to .env
VERIFY  : Re-read .env → PAYCRAFT_PLAN_COUNT=[N] AND all PAYCRAFT_PLAN_[1..N]_* keys present and non-empty
IF COUNT MISMATCH OR ANY EMPTY:
  HARD STOP: "Plan keys not all written to .env. Re-run this step."
OUTPUT  : "✓ Plans configured: [list plan IDs with prices]"
          Example: "✓ Plans: monthly ₹9 | yearly ₹79"
```

### STEP 1.6 — Collect support email + redirect URL

```
CHECK   : PAYCRAFT_SUPPORT_EMAIL in .env
IF EMPTY:
  ASK   : "Support email shown in paywall (e.g. support@yourapp.com):"
  VALIDATE : contains "@" and "."
  IF INVALID : HARD STOP — "Invalid email format."
  WRITE : PAYCRAFT_SUPPORT_EMAIL to .env

CHECK   : PAYCRAFT_APP_REDIRECT_URL in .env
IF EMPTY:
  CHECK   : Does target_app_path contain existing payment/paywall code?
            Search for: redirectUrl, successUrl, buy.stripe.com, deep link scheme in AndroidManifest.xml
  IF FOUND existing scheme (e.g. "reelsdownloader://"):
    SUGGEST : "{scheme}://paycraft/premium/success" (derived from existing scheme — paycraft/ namespace avoids conflict with other deep links)
    ASK     : "Use [{suggestion}] as redirect URL? [Y] Yes / [N] Enter custom URL"
    IF [Y]  : use suggestion
    IF [N]  : ASK custom URL
  ELSE:
    DISPLAY : "Redirect URL after successful payment:"
              "(This is where Stripe sends users after payment)"
              "Examples: https://yourapp.com/welcome  OR  yourapp://payment-success"
              "For Android KMP apps: use a deep link like myapp://payment-success"
              "NOTE: Phase 4 will register this scheme in AndroidManifest.xml if not already present"
    ASK     : URL
  VALIDATE : starts with "https://" or contains "://"
  WRITE   : PAYCRAFT_APP_REDIRECT_URL to .env

VERIFY  : Both keys non-empty in .env
OUTPUT  : "✓ Support email and redirect URL set"
```

### STEP 1.7 — Key format validation (S1 — validate all keys at collection time)

```
Run final validation on all collected keys — format, prefix, length:

VALIDATE PAYCRAFT_SUPABASE_URL:
  MUST match regex: ^https://[a-z0-9]+\.supabase\.co$
  IF INVALID: HARD STOP — "Invalid Supabase URL format.
              Expected: https://{ref}.supabase.co
              Get it at: https://supabase.com/dashboard/project/{ref}/settings/api → 'Project URL'"

VALIDATE PAYCRAFT_SUPABASE_ANON_KEY:
  MUST start with "eyJ" AND length > 100
  IF INVALID: HARD STOP — "Invalid anon key format.
              Must be a JWT starting with eyJ (100+ chars).
              Get it at: same Settings → API page → 'anon public'"

VALIDATE PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY:
  MUST start with "eyJ" AND length > 100 AND differ from ANON_KEY
  IF SAME AS ANON: HARD STOP — "Service role key must differ from anon key.
              You may have pasted the anon key twice.
              The service_role key is separate — click 'Reveal' on the service_role row."

VALIDATE PAYCRAFT_SUPABASE_ACCESS_TOKEN:
  MUST start with "sbp_"
  IF INVALID: HARD STOP — "Invalid Supabase access token.
              Must start with sbp_
              Get it at: https://supabase.com/dashboard/account/tokens → 'Generate new token'"

IF PAYCRAFT_PROVIDER = "stripe":
  VALIDATE PAYCRAFT_STRIPE_TEST_SECRET_KEY:
    MUST start with "sk_test_" AND length > 30
    IF starts with "sk_live_": HARD STOP — "Live key detected in TEST field.
                Switch Stripe Dashboard to TEST mode (toggle top-left) and copy the sk_test_ key."
    IF NOT starts with "sk_": HARD STOP — "Not a Stripe secret key format (must start with sk_test_)."

  IF PAYCRAFT_STRIPE_LIVE_SECRET_KEY non-empty:
    VALIDATE: MUST start with "sk_live_" AND length > 30
    IF INVALID: HARD STOP — "Invalid live key format. Must start with sk_live_."

OUTPUT: "✓ All key formats validated"
```

### STEP 1.8 — Write memory.json (M3a — atomic write)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
TMP_PATH    = {TARGET_APP_PATH}/.paycraft/memory.json.tmp

BUILD memory object:
  IF memory.json exists: READ existing → merge (preserve existing fields, update/add new)
  ELSE: start fresh

SET fields:
  paycraft_version        = current PayCraft version (from schema_version file)
  last_run                = current ISO timestamp
  env_path                = {ENV_PATH}
  env_path_confirmed_by_user = true
  phases_completed        = add "env" if not already present

WRITE: JSON to {TMP_PATH}
RENAME: {TMP_PATH} → {MEMORY_PATH}  (atomic — prevents corrupt partial writes)
OUTPUT: "✓ Phase 1 state saved → .paycraft/memory.json"
```

---

## Phase 1 Checkpoint

```
╔══ PHASE 1 COMPLETE — ENV Bootstrap ════════════════════════════════════╗
║                                                                          ║
║  ✓ .paycraft/ directory initialized                                      ║
║  ✓ .env location confirmed: {ENV_PATH}                                   ║
║  ✓ .env / .gitignore updated                                             ║
║  ✓ Provider: [stripe/razorpay]                                           ║
║  ✓ Supabase: [project-ref].supabase.co (5 keys — all formats valid)     ║
║  ✓ Mode: [PAYCRAFT_MODE]                                                 ║
║  ✓ [Provider] credentials: TEST key set, LIVE key [set/pending]         ║
║  ✓ Plans: [N] plans ([list with prices])                                 ║
║  ✓ Support email: [email]                                                ║
║  ✓ App redirect URL: [url]                                               ║
║  ✓ memory.json written                                                   ║
║                                                                          ║
║  Ready to proceed to Phase 2: Supabase Setup?                           ║
║  [Y] Continue   [Q] Quit                                                 ║
╚══════════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding to Phase 2.
If user types `[Q]`: save .env state, display "Run /paycraft-adopt to resume — select [A] Full setup or [F] Fix specific phase from the action menu."
