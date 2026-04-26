# PayCraft Client Skills

These Claude skills automate PayCraft integration into any KMP client app.

---

## Option A — Bootstrap (no clone required, recommended)

Paste this single prompt into Claude Code **in your KMP project**:

```
Fetch https://raw.githubusercontent.com/mobilebytelabs/paycraft/main/client-skills/paycraft-adopt.md
Save it to .claude/commands/paycraft-adopt.md in this project, then run /paycraft-adopt.
```

Claude will:
1. Fetch the adoption command from GitHub
2. Save it to your project's `.claude/commands/`
3. Run `/paycraft-adopt` — which:
   - Searches 8 common locations for an existing PayCraft clone
   - If not found, **asks where you want to clone it** (home dir / Developer/ / custom path)
   - Clones PayCraft there, saves the path to your `.env` for future runs
   - Wires billing into your app end-to-end

No cloning required upfront. No directory switching. Works from any KMP project.

**On subsequent runs** — PayCraft path is remembered in `.env` (`PAYCRAFT_ROOT`), so the clone question is skipped.

---

## Option B — Manual install (copy files)

1. Copy the `.md` files from this directory to your project's `.claude/commands/`:
   ```bash
   mkdir -p .claude/commands
   # Full E2E command (handles everything including Supabase + Stripe + client integration):
   cp paycraft-adopt.md .claude/commands/
   # Individual phase commands (optional — for partial re-runs):
   cp paycraft-adopt-env.md .claude/commands/
   cp paycraft-adopt-supabase.md .claude/commands/
   cp paycraft-adopt-stripe.md .claude/commands/
   cp paycraft-adopt-razorpay.md .claude/commands/
   cp paycraft-adopt-client.md .claude/commands/
   cp paycraft-adopt-verify.md .claude/commands/
   # Migration command (for moving to new Supabase/Stripe account later):
   cp paycraft-adopt-migrate.md .claude/commands/
   ```

2. Open Claude Code in your KMP project
3. Run `/paycraft-adopt`

> On first run, Claude will ask where to clone PayCraft if it's not already on your system.
> The chosen path is saved to `.env` as `PAYCRAFT_ROOT` — subsequent runs skip the question.

---

## Available Skills

| Skill | Purpose |
|-------|---------|
| `/paycraft-adopt` | **E2E setup: env + Supabase + provider + client + verify** (start here) |
| `/paycraft-adopt-env` | Phase 1 only — credentials setup |
| `/paycraft-adopt-supabase` | Phase 2 only — migrations + webhook |
| `/paycraft-adopt-stripe` | Phase 3 only — Stripe test products + links |
| `/paycraft-adopt-razorpay` | Phase 3B only — Razorpay plans + links |
| `/paycraft-adopt-client` | Phase 4 only — wire billing into app |
| `/paycraft-adopt-verify` | Phase 5 only — end-to-end DB + RPC verification |
| `/paycraft-adopt-migrate` | Migrate to new Supabase / Stripe / Razorpay account, or switch provider |
| `/paycraft-setup` | Legacy: client integration only (assumes server already done) |
| `/paycraft-verify` | Legacy: verify integration only |

---

## What gets created in your project

After `/paycraft-adopt` completes, your project contains a `.paycraft/` directory:

```
your-kmp-app/
└── .paycraft/
    ├── config.json          ← setup answers (billing UI path, key storage, provider, plans)
    ├── deployment.json      ← deployed resource IDs — no secrets, safe to commit
    ├── supabase/
    │   ├── migrations/      ← SQL backup of what was applied to Supabase
    │   └── functions/       ← Edge Function source backup (stripe-webhook/ or razorpay-webhook/)
    ├── backups/             ← gitignored — timestamped .env + deployment backups
    └── exports/             ← subscriber data exports (written during /paycraft-adopt-migrate)
```

`config.json` records all answers you gave during setup:
- Which file has `PayCraft.configure()` (app init file)
- Which screen hosts the billing UI (SettingsScreen or paywall host)
- How keys are stored (`local.properties`, `Config.kt`, `BuildConfig`, or inline)
- Provider choice (stripe / razorpay), plan count, plan definitions

`deployment.json` records all deployed resource IDs:
- Supabase project ref + URL + webhook function name
- Stripe product ID + price IDs + payment link URLs (or Razorpay plan IDs)
- Migration history (updated by `/paycraft-adopt-migrate`)

**gitignore**: Step 5 automatically updates your `.gitignore` — `.env` (PayCraft credentials) and `.paycraft/backups/` (timestamped `.env` copies) are both excluded. Everything else in `.paycraft/` is safe and useful to commit.

---

## Migrating later

To move to a new Supabase project, new Stripe account, or switch payment providers:

```
/paycraft-adopt-migrate
```

Claude will:
1. Show your current deployment state from `.paycraft/deployment.json`
2. Ask what you want to migrate (Supabase / Stripe / Razorpay / Both / Switch)
3. Back up `.env` → `.paycraft/backups/.env.backup.{timestamp}`
4. Collect only the new credentials needed
5. Re-deploy only the affected components
6. Optionally migrate your subscriber data to the new Supabase project
7. Re-verify everything end-to-end
8. Update `.paycraft/deployment.json` with the new state + migration history

No manual `.env` editing. No re-running the full setup from scratch.

---

## Requirements

- KMP app using Koin DI + Compose Multiplatform
- Supabase project (free tier works)
- Stripe or Razorpay account (test mode for setup)
- Claude Code with internet access (for Stripe MCP, optional but recommended)

## What `/paycraft-adopt` Does to Your App

- Applies Supabase migrations (`subscriptions` table + `is_premium()` + `get_subscription()`)
- Deploys the webhook Edge Function to Supabase
- Creates Stripe/Razorpay test products, prices, payment links
- Adds `io.github.mobilebytelabs:paycraft` dependency to `commonMain`
- Writes `PayCraft.configure {}` before Koin initialization
- Adds `PayCraftModule` to Koin modules
- Adds `PayCraftBanner` + `PayCraftSheet` + `PayCraftRestore` to SettingsScreen
- Runs a live DB write → `is_premium()` → cleanup verification test
