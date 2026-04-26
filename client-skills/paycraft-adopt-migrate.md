# /paycraft-adopt-migrate

Migrate an existing PayCraft deployment to a new Supabase project, new Stripe/Razorpay
account, or switch payment providers. Backs up all state before any change.

> Install this file: copy to `.claude/commands/paycraft-adopt-migrate.md` in your KMP app.

---

## STEP 0 — Resolve paths

```
PROJECT_ROOT = current working directory (your KMP app)
DEPLOYMENT_DIR = {PROJECT_ROOT}/.paycraft/

VERIFY: {DEPLOYMENT_DIR}deployment.json exists
IF NOT FOUND:
  HARD STOP: "No deployment state found at .paycraft/deployment.json.
              Run /paycraft-adopt first to create an initial deployment."

READ: PAYCRAFT_ROOT from {PROJECT_ROOT}/.env
IF NOT SET:
  HARD STOP: "PAYCRAFT_ROOT not set in .env.
              Run /paycraft-adopt first to set up PayCraft."

VERIFY: {PAYCRAFT_ROOT}/server/migrations/001_create_subscriptions.sql exists
IF NOT FOUND:
  DISPLAY: "PayCraft library not found at: {PAYCRAFT_ROOT}"
           "Update PAYCRAFT_ROOT in .env to point to your PayCraft clone."
  HARD STOP.
```

---

## STEP 1 — Load and execute migrate command

```
Load: {PAYCRAFT_ROOT}/layers/paycraft/commands/paycraft-adopt-migrate.md

Execute all steps (M.0 through M.8) with these pre-set variables:
  - DEPLOYMENT_DIR = {PROJECT_ROOT}/.paycraft/
  - TARGET_APP_PATH = {PROJECT_ROOT}
  - PAYCRAFT_ROOT = {PAYCRAFT_ROOT}
```

---

## What this command does

| Step | Action |
|------|--------|
| M.0 | Show current deployment state from `.paycraft/deployment.json` |
| M.1 | Ask which migration type (Supabase / Stripe / Razorpay / Both / Switch provider) |
| M.2 | Backup `.env` + `deployment.json` to `.paycraft/backups/` |
| M.3 | Collect new credentials for what's changing |
| M.4 | Export + import subscriber data (optional, user-gated) |
| M.5 | Deploy to new targets (re-runs only affected phases) |
| M.6 | Update app config (`local.properties` / `Config.kt` + `PayCraft.configure()`) |
| M.7 | Full E2E verification on new deployment |
| M.8 | Update `.paycraft/deployment.json` + refresh `.paycraft/supabase/` backup |

## Migration types

| Option | What changes |
|--------|-------------|
| `[1] Supabase only` | New Supabase project — re-deploys migrations + webhook, migrates subscriber data |
| `[2] Stripe only` | New Stripe account — re-creates products, prices, payment links, webhook |
| `[3] Razorpay only` | New Razorpay account — re-creates plans, payment links, webhook |
| `[4] Both` | New Supabase + new payment provider account |
| `[5] Switch provider` | Stripe ↔ Razorpay — deploys new provider, updates app config |

## Your .paycraft/ directory

After setup (and after any migration), your project contains:

```
.paycraft/
├── config.json              ← setup answers (billing UI path, key storage, provider, plans)
├── deployment.json          ← current deployment state (no secrets — safe to commit)
├── supabase/
│   ├── migrations/          ← SQL backup of deployed migrations
│   └── functions/           ← Edge Function source backup
├── backups/                 ← gitignored — .env + deployment backups with timestamps
└── exports/                 ← subscriber data exports (migration M.4)
```

`.paycraft/backups/` is gitignored (contains .env copies with secrets).
Everything else is safe to commit as deployment documentation.
