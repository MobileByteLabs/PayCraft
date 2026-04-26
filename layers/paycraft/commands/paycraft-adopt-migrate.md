# paycraft-adopt-migrate — Migrate Supabase or Payment Provider

> Migrate an existing PayCraft deployment to a new Supabase project, new Stripe/Razorpay
> account, or switch payment provider entirely.
> Backs up `.env` before any change. Re-runs only the affected phases. Re-verifies at the end.

---

## Prerequisites

NOTE: Run this command from the ADOPTING PROJECT directory (where Claude Code is open).
      The .paycraft/ directory lives in the adopting project, not in the PayCraft library.

DEPLOYMENT_DIR = {current_working_directory}/.paycraft/
  (same as TARGET_APP_PATH used during /paycraft-adopt)

Read `.env` → confirm:
- `PAYCRAFT_SUPABASE_PROJECT_REF` non-empty (existing deployment exists)

Read `{DEPLOYMENT_DIR}deployment.json` → confirm it exists
IF NOT FOUND:
  HARD STOP: "No deployment state found at .paycraft/deployment.json.
              Run /paycraft-adopt first to create an initial deployment.
              (Expected location: {current_working_directory}/.paycraft/deployment.json)"

Read `{DEPLOYMENT_DIR}config.json` → confirm it exists (setup answers)
IF NOT FOUND:
  DISPLAY: "⚠️  config.json not found — setup answers unavailable.
             Migration will proceed but app config update (Step M.6) will ask questions."

---

## STEP M.0 — Show current deployment state

```
READ: {DEPLOYMENT_DIR}deployment.json
READ: {DEPLOYMENT_DIR}config.json (if exists)

DISPLAY:
  "╔══ Current PayCraft Deployment ══════════════════════════════╗"
  "║                                                              ║"
  "║  SUPABASE                                                    ║"
  "║    Project : [supabase.project_ref]                         ║"
  "║    URL     : [supabase.url]                                  ║"
  "║    Deployed: [supabase.last_deployed]                        ║"
  "║                                                              ║"
  "║  [PROVIDER]                                                  ║"
  "║    Account  : [provider.account_id or account_key_prefix]   ║"
  "║    Mode     : [TEST/LIVE]                                    ║"
  "║    Plans    : [N] plans, [N] payment links                  ║"
  "║    Deployed : [provider.last_deployed]                       ║"
  "║                                                              ║"
  "║  APP                                                         ║"
  "║    Path     : [app.path]                                     ║"
  "║    Init file: [app.init_file]                                ║"
  "║                                                              ║"
  "╚══════════════════════════════════════════════════════════════╝"
```

---

## STEP M.1 — Ask migration type

```
DISPLAY:
  "What do you want to migrate?"
  ""
  "[1] Supabase only      — new Supabase project (keep same payment provider)"
  "[2] Stripe only        — new Stripe account (keep same Supabase)"
  "[3] Razorpay only      — new Razorpay account (keep same Supabase)"
  "[4] Both               — new Supabase + new payment provider account"
  "[5] Switch provider    — change from Stripe → Razorpay or Razorpay → Stripe"
  ""
  "Common reasons:"
  "  [1] Moving to a different Supabase org / project tier upgrade"
  "  [2][3] Rotating accounts, moving from test → live in new account"
  "  [4] Full re-deployment (disaster recovery, new environment)"
  "  [5] Switching payment provider"

WAIT: user picks 1–5
STORE: migration_type
```

---

## STEP M.2 — Backup current state

```
TIMESTAMP = current datetime as YYYYMMDD_HHMMSS (e.g. 20260425_143022)
BACKUP_DIR = {DEPLOYMENT_DIR}backups/

CREATE DIR: {BACKUP_DIR} (if not exists)

ACTION: Copy .env → {BACKUP_DIR}.env.backup.{TIMESTAMP}
VERIFY: {BACKUP_DIR}.env.backup.{TIMESTAMP} exists and is non-empty
OUTPUT: "✓ .env backed up → .paycraft/backups/.env.backup.{TIMESTAMP}"

ACTION: Copy {DEPLOYMENT_DIR}deployment.json → {BACKUP_DIR}deployment.backup.{TIMESTAMP}.json
OUTPUT: "✓ Deployment state backed up → .paycraft/backups/deployment.backup.{TIMESTAMP}.json"

IF {DEPLOYMENT_DIR}config.json exists:
  ACTION: Copy {DEPLOYMENT_DIR}config.json → {BACKUP_DIR}config.backup.{TIMESTAMP}.json
  OUTPUT: "✓ Setup config backed up → .paycraft/backups/config.backup.{TIMESTAMP}.json"

DISPLAY:
  "ℹ️  To roll back: cp .paycraft/backups/.env.backup.{TIMESTAMP} .env"
  "    Then re-run /paycraft-adopt-verify to confirm rollback."
  "    (.paycraft/backups/ is gitignored — backups stay local)"
```

---

## STEP M.3 — Collect new credentials (only for what's changing)

### IF migration_type = 1 or 4 (Supabase changing):

```
DISPLAY: "Collecting new Supabase credentials..."
DISPLAY: "Leave a field blank to keep the current value."

Run: Phase 1 Step 1.3 (Supabase credentials only)
  - PAYCRAFT_SUPABASE_PROJECT_REF
  - PAYCRAFT_SUPABASE_URL         (auto-derived from new ref)
  - PAYCRAFT_SUPABASE_ANON_KEY
  - PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY
  - PAYCRAFT_SUPABASE_ACCESS_TOKEN

VERIFY: new ref is DIFFERENT from old ref in deployment.json
IF SAME:
  DISPLAY: "⚠️  New Supabase project ref is the same as current ([ref])."
           "Are you sure? This will re-deploy to the same project. [Y] Continue / [N] Cancel"
  WAIT: user confirms
```

### IF migration_type = 2 or 4 (Stripe changing):

```
DISPLAY: "Collecting new Stripe credentials..."
Run: Phase 1 Step 1.4 (Stripe credentials only — sk_test_ enforced)

VERIFY: new account info different from deployment.json provider.account_id
  (Call mcp__stripe__get_stripe_account_info → check acct_ ID vs stored)
IF SAME ACCOUNT:
  DISPLAY: "⚠️  This is the same Stripe account ([acct_id]). Continuing will recreate resources."
           "[Y] Continue / [N] Cancel"
```

### IF migration_type = 3 or 4 (Razorpay changing):

```
DISPLAY: "Collecting new Razorpay credentials..."
Run: Phase 1 Step 1.4 (Razorpay credentials only)
```

### IF migration_type = 5 (Provider switch):

```
READ: current provider from deployment.json → provider.name

IF current = stripe:
  new_provider = razorpay
  DISPLAY: "Switching from Stripe → Razorpay."
           "New Razorpay credentials needed:"
  Run: Phase 1 Step 1.4 (Razorpay)
  WRITE: PAYCRAFT_PROVIDER=razorpay to .env

IF current = razorpay:
  new_provider = stripe
  DISPLAY: "Switching from Razorpay → Stripe."
           "New Stripe credentials needed:"
  Run: Phase 1 Step 1.4 (Stripe)
  WRITE: PAYCRAFT_PROVIDER=stripe to .env
```

---

## STEP M.4 — Migrate data (subscriptions export/import, if Supabase changing)

### Only runs if migration_type = 1 or 4

```
DISPLAY:
  "Do you want to migrate existing subscriber data to the new Supabase project?"
  "(Recommended: keeps active subscribers from losing access)"
  "[Y] Yes — export + import subscriptions   [N] Skip (start fresh)"

IF [Y]:
  DISPLAY: "Exporting current subscriptions..."
  ACTION: GET https://[OLD_SUPABASE_URL]/rest/v1/subscriptions
          Header: apikey: [PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY (OLD)]
          Header: Authorization: Bearer [OLD SERVICE_ROLE_KEY]
          ?select=email,provider,provider_customer_id,provider_subscription_id,
                  plan,status,current_period_start,current_period_end,cancel_at_period_end
  VERIFY: HTTP 200
  CAPTURE: rows array
  COUNT: N rows

  IF N = 0:
    DISPLAY: "No subscriber rows to migrate. Skipping data import."
  IF N > 0:
    DISPLAY: "Found [N] subscriber rows to migrate."
    WRITE: {DEPLOYMENT_DIR}exports/subscriptions_export_{TIMESTAMP}.json (local backup)
    CREATE DIR: {DEPLOYMENT_DIR}exports/ (if not exists)
    OUTPUT: "✓ Exported [N] rows → .paycraft/exports/subscriptions_export_{TIMESTAMP}.json"
    NOTE: exports/ is NOT gitignored — subscriber data is deployment context, not secrets

    [After new Supabase is deployed in M.5]:
    FOR EACH ROW:
      POST https://[NEW_SUPABASE_URL]/rest/v1/subscriptions
           Header: apikey: [NEW SERVICE_ROLE_KEY]
           Body: {row data — exclude id, created_at, updated_at (let DB generate)}
    VERIFY: All rows imported (count SELECT on new DB = N)
    OUTPUT: "✓ Migrated [N] subscriber rows to new Supabase project"

IF [N]:
  DISPLAY: "⚠️  Existing subscribers will not be in the new project."
           "They will lose premium access until they re-subscribe."
```

---

## STEP M.5 — Deploy to new targets

### IF Supabase changing (migration_type 1, 4, 5-with-supabase):

```
DISPLAY: "Deploying to new Supabase project: [new ref]..."
Run: Phase 2 (paycraft-adopt-supabase.md) with new Supabase credentials
  - All 9 steps execute against the NEW project
  - After success: import subscriber data (if M.4 said yes)
  - Deploy new provider webhook ([provider]-webhook) to new project
```

### IF Stripe changing (migration_type 2, 4):

```
DISPLAY: "Setting up PayCraft on new Stripe account..."
Run: Phase 3 (paycraft-adopt-stripe.md) with new Stripe credentials
  - Creates new test product, prices, payment links on new account
  - Step 3.5: New webhook endpoint must point to CURRENT (or new) Supabase URL
  - Step 3.6: Verify 4 events on new webhook
```

### IF Razorpay changing (migration_type 3, 4):

```
Run: Phase 3B (paycraft-adopt-razorpay.md) with new Razorpay credentials
```

### IF provider switch (migration_type 5):

```
Run: Phase 3 or 3B for the NEW provider (whichever was selected)
  - Creates all new resources on new provider
  - Deploys new webhook to existing Supabase project
  - Removes old provider webhook? Ask:
    "[Y] Delete old [provider] webhook from Supabase (recommended)
     [N] Keep both deployed (old webhook will receive no events)"
  IF [Y]:
    ACTION: supabase functions delete [old_provider]-webhook
              --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
    OUTPUT: "✓ Old [provider]-webhook removed"
```

---

## STEP M.6 — Update app config

```
READ: {DEPLOYMENT_DIR}config.json → app.path, app.init_file, app.billing_ui_file, app.key_storage
  (falls back to {DEPLOYMENT_DIR}deployment.json → app.* if config.json missing)

IF Supabase URL changed:
  UPDATE app key storage (local.properties / Config.kt) with new SUPABASE_URL + ANON_KEY
  VERIFY: Re-read key storage file → new values present

IF payment links changed (new Stripe/Razorpay account OR provider switch):
  UPDATE PayCraft.configure() in app.init_file:
    - New payment links map
    - New customerPortalUrl (if Stripe changed)
    - New provider class (if provider switch: StripeProvider ↔ RazorpayProvider)
  VERIFY: Re-read init_file → new link values present

OUTPUT: "✓ App config updated with new credentials"
```

---

## STEP M.7 — Verify migration

```
DISPLAY: "Running full end-to-end verification on new deployment..."
Run: Phase 5 (paycraft-adopt-verify.md) — all 9 steps against new credentials
  - Uses new Supabase URL/keys (if changed)
  - Uses new payment links (if changed)
  - E2E DB write → is_premium() → cleanup
```

---

## STEP M.8 — Update deployment state and refresh backups

```
READ: existing {DEPLOYMENT_DIR}deployment.json
UPDATE with new values:
  - supabase.* → new project ref, URL, last_deployed = now (if Supabase changed)
  - provider.* → new account, product_id, prices, links (if provider changed)
  - provider.name → new provider name (if provider switch)
  - migration_history → append:
      {
        "type": "[1-5 migration type description]",
        "from": { "supabase_ref": "...", "provider_account": "..." },
        "to": { "supabase_ref": "...", "provider_account": "..." },
        "timestamp": "[ISO8601]",
        "backup_file": ".paycraft/backups/deployment.backup.{TIMESTAMP}.json"
      }
WRITE: {DEPLOYMENT_DIR}deployment.json

IF Supabase changed:
  ACTION: Re-copy {paycraft_root}/server/migrations/*.sql
          → {DEPLOYMENT_DIR}supabase/migrations/
  ACTION: Re-copy {paycraft_root}/server/functions/{provider}-webhook/
          → {DEPLOYMENT_DIR}supabase/functions/{provider}-webhook/
  OUTPUT: "✓ Supabase resources updated in .paycraft/supabase/"

IF provider switch (migration_type 5):
  READ: config.json → update provider field to new provider name
  WRITE: {DEPLOYMENT_DIR}config.json

OUTPUT: "✓ Deployment state updated → .paycraft/deployment.json"
```

---

## Migration Checkpoint

```
╔══ MIGRATION COMPLETE ════════════════════════════════════════╗
║                                                               ║
║  Migration type: [type description]                           ║
║  Backup: .paycraft/backups/.env.backup.{TIMESTAMP}           ║
║          .paycraft/backups/deployment.backup.{TIMESTAMP}.json ║
║                                                               ║
║  NEW STATE                                                    ║
║  Supabase : [new ref or "unchanged"]                         ║
║  Provider : [new account or "unchanged" or "switched to X"]  ║
║  Data     : [N rows migrated or "skipped"]                   ║
║                                                               ║
║  ✓ E2E verification passed on new deployment                 ║
║  ✓ .paycraft/deployment.json updated                         ║
║  ✓ .paycraft/supabase/ refreshed                             ║
║                                                               ║
║  To roll back: cp .paycraft/backups/.env.backup.{TIMESTAMP} .env ║
║                then run /paycraft-adopt-verify               ║
╚═══════════════════════════════════════════════════════════════╝
```
