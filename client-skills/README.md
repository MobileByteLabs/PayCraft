# PayCraft Client Skills

These Claude skills automate PayCraft integration into any KMP client app.

**One command. Zero sub-commands exposed.** All phases (Supabase, Stripe, client wiring, verification) run internally.

---

## Install & Run (one prompt)

Paste this into Claude Code **in your KMP project**:

```
Fetch https://raw.githubusercontent.com/mobilebytelabs/paycraft/development/client-skills/paycraft-adopt.md
Save it to .claude/commands/paycraft-adopt.md in this project, then run /paycraft-adopt.
```

Claude will:
1. Fetch the stub from GitHub
2. Save it to `.claude/commands/`
3. Run `/paycraft-adopt` — which finds or clones PayCraft, then runs the full adoption flow

No cloning required upfront. No directory switching. Works from any KMP project.

---

## Manual install

```bash
mkdir -p .claude/commands
cp paycraft-adopt.md .claude/commands/
```

Open Claude Code in your project, then run `/paycraft-adopt`.

---

## One User-Facing Command

| Command | Purpose |
|---------|---------|
| `/paycraft-adopt` | **Everything** — status matrix → full setup → sandbox E2E → live test → keys guide |
| `/paycraft-setup` | Legacy (client integration only) |
| `/paycraft-verify` | Legacy (verify only) |

To re-run a specific phase: `/paycraft-adopt` → **[F] Fix specific phase**.

---

## What `/paycraft-adopt` does

1. **Status matrix** — shows current implementation state (reads `.paycraft/memory.json`)
2. **[A] Full setup** — Phases 1→5:
   - Phase 1: Collect + validate all credentials (Supabase + Stripe/Razorpay)
   - Phase 2: Deploy Supabase migrations + webhook Edge Function
   - Phase 3: Create Stripe products, prices, payment links
   - Phase 4: Wire PayCraft into your KMP app (commonMain only)
   - Phase 5: E2E DB write + RPC verification
3. **[B] Sandbox E2E** — 7-step test with Stripe test card — proof billing works
4. **[C] Live test** — E2E with real card + real keys
5. **[D] Keys guide** — exact steps to get every key/secret with dashboard URLs
6. **[F] Fix phase** — re-run any single phase

---

## `.paycraft/` Memory Directory

After Phase 1 completes, your project contains:

```
your-kmp-app/
└── .paycraft/
    ├── memory.json          ← remembered context (env path, koin file, billing screen, etc.)
    ├── config.json          ← setup answers (provider, plans, currency, support email)
    ├── deployment.json      ← deployed resource IDs — no secrets, safe to commit
    ├── schema_version       ← PayCraft version this memory was created with
    ├── supabase/
    │   ├── migrations/      ← SQL backup of what was deployed
    │   └── functions/       ← Edge Function source backup
    ├── test_results/
    │   ├── sandbox_test.json ← Sandbox E2E test result + timestamp
    │   └── live_test.json    ← Live E2E test result
    └── backups/             ← gitignored — timestamped .env snapshots
```

### What `memory.json` remembers

| Field | Set in | Used in |
|-------|--------|---------|
| `env_path` | Phase 1 | All phases — never ask again |
| `env_path_confirmed_by_user` | Phase 1 | Skip .env picker on re-run |
| `koin_module_file` + `koin_module_line` | Phase 4 | Phase 4 re-run — skip detection |
| `billing_card_file` + `billing_card_line` | Phase 4 | Phase 4 re-run — skip detection |
| `lifecycle_refresh_file` | Phase 4 | Phase 4 re-run — skip detection |
| `configure_file` | Phase 4 | Status matrix |
| `deep_link_scheme` | Phase 4 | Status matrix |
| `supabase_project_ref` | Phase 2 | Status matrix |
| `stripe_product_id` | Phase 3 | Status matrix |
| `payment_links` | Phase 3 | Status matrix |
| `phases_completed` | All phases | Smart-skip in full setup |
| `phases_verified` | Phase 5 | Status matrix |

### gitignore

`.paycraft/backups/` and `.paycraft/exports/` are automatically added to your `.gitignore` (contain `.env` snapshots = secrets). Everything else is safe and useful to commit.

---

## Requirements

- KMP app using Koin DI + Compose Multiplatform
- Supabase project (free tier works)
- Stripe or Razorpay account (test mode for initial setup)
- Claude Code

---

## 100% Success Design

Every connection step is zero-guesswork:
- Per-key validation at collection: format + prefix + length checks with exact error messages
- Inline "where to get it" guide for every key (exact dashboard URLs + field names)
- Pre-flight gate before each phase (APIs must be reachable before any work starts)
- Post-phase verification (proves it worked — table exists, RPCs callable, webhook ACTIVE)
- Idempotent: re-running never duplicates Supabase migrations or Stripe products
- Sandbox E2E: 7-step test with 30s webhook timeout + exact diagnosis on failure
