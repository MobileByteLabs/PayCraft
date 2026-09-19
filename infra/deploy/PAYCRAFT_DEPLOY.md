# PayCraft Deploy — Full Workflow Spec

> Loaded by `/paycraft-deploy` skill (framework-level slim wrapper at `.claude/skills/paycraft-deploy/SKILL.md`).
> Orchestrated by `infra/deploy/deploy.sh` — **that script's header comment is the
> source of truth for phase behavior**; this file is the operator-facing companion.

> **2026-09-17 — rewritten.** The prior revision documented a 9-phase Vercel + Wix-DNS
> pipeline with a `sync-to-vercel.sh` sub-script. None of that exists: the dashboard
> left Vercel on 2026-08-23 (briefly Workers/OpenNext, then Cloudflare **Pages** via
> `@cloudflare/next-on-pages`), DNS moved from Wix to Cloudflare, and
> `infra/sync-to-vercel.sh` was deleted. Phases below mirror the four real modes.

## Goal

**One command takes a fresh machine to a live PayCraft v2.0 deployment** at
`https://paycraft.mobilebytesensei.com`. `/paycraft-deploy` auto-fixes what can be
automated (CLI installs, auth, project linking, vault collection, npm install) and
prompts inline for what only you can provide (live API keys, OAuth callbacks).

End-state delivered:
- Production secrets vaulted + synced (Cloudflare **Pages** secrets + Supabase Edge Function secrets)
- All pending migrations applied to the production Supabase project
- Dashboard built by `next-on-pages` + deployed to Cloudflare Pages project `paycraft`
- Custom domain `paycraft.mobilebytesensei.com` served via Cloudflare DNS (proxied)
- TLS provisioned automatically by Cloudflare
- Health check + smoke confirming end-to-end up

## Invariants

| ID | Rule |
|---|---|
| D-1 | Dry-run is the default; `--apply` required for mutations (RULE-AUTO-FIX-001) |
| D-2 | Every secret pulled via `secrets-get.sh --to-file` to a tmpfile, never stdout (RULE-SECRETS-VAULT-001 SV32) |
| D-3 | Pre-flight blocks on missing prerequisites — no partial deploys |
| D-4 | SMOKE is a gate — non-200 marks the deploy failed, NOT successful (RULE-VERIFY-COMPLETION-001) |
| D-5 | Resumable via `--from-phase` / `--to-phase` / `--only-phase` |
| D-6 | Per-phase status matrix rendered after every run; final summary banner |
| D-7 | DNS is **not** a deploy phase. The zone lives on Cloudflare and the custom domain is already attached; see `infra/dns-records.md` |
| D-8 | Refuses to run unless `session-resolve.sh` returns `mbs/PayCraft` |
| D-9 | Production requires `--apply --confirm-production` two-flag explicit consent |
| D-10 | `--promote-to-prod` is gated on staging having been deployed AND smoked AND HEAD unmoved — promoting an un-rehearsed commit is what staging exists to prevent |

## CLI

```
deploy.sh [MODE] [OPTIONS]

Modes (pick one):
  --local                       Run PayCraft on http://localhost:3000 (L1..L5)
  --staging                     Deploy WHATEVER IS CHECKED OUT to staging (rehearsal, no promote)
  --promote-to-prod             Prod chain, gated on a matching smoked staging deploy
  --prod                        Build + deploy `dev` directly to Cloudflare Pages

Safety:
  --dry-run                     (default) Show what would happen, no mutations
  --apply                       Execute for real
  --confirm-production          Required alongside --apply for prod
  --allow-destructive           Permit destructive migration ops (scanned for by default)
  --allow-no-backup             Proceed without a pre-push schema backup

Scoping:
  --from-phase N / --to-phase N / --only-phase N
  --skip-build                  Skip the typecheck+build (redeploy only)
  --sync-prod / --no-sync-prod  (local mode) pull prod data into the local stack

Behavior:
  --keep-going | --verbose | --silent
```

## Phase spec — `--prod`

| Phase | Name | What it does |
|---|---|---|
| 1 | PRE-FLIGHT | Verify CLIs / vault / Cloudflare / gh; warn on un-pushed `dev` commits; **typecheck** the dashboard (`tsc --noEmit`) so a broken build never ships (`--skip-build` bypasses) |
| 2 | SECRETS SYNC | vault → Cloudflare Pages secrets, driven by `dashboard/cloudflare-secrets.map` (`wrangler pages secret put <ENV> --project-name paycraft`). Best-effort: a nullable alias missing from the vault is skipped, not fatal |
| 3 | MIGRATIONS | Detect pending (`db push --dry-run`) → DESTRUCTIVE-op scan (gated by `--allow-destructive`) → pre-push schema BACKUP → `supabase db push` → POST-PUSH VERIFY (0 pending). Aborts the chain on any failure |
| 3.5 | FUNCTIONS DEPLOY | Vault-mediated `supabase functions deploy` per directory under `supabase/functions/` that has an `index.ts` (`_shared` + `__tests__` have none, so they are skipped by construction) |
| 4 | PROMOTE | **Retired** — `dev` is the deploy branch; the phase reports SKIP |
| 5 | DEPLOY CLOUDFLARE | `npm run pages:deploy` = `@cloudflare/next-on-pages` then `wrangler pages deploy .vercel/output/static --project-name=paycraft --branch=main` |
| 6 | SMOKE | `curl` `/api/health` + `/auth/login` + root + Edge Function `/config` reachability |

Two things in phase 5 that look wrong and are not:

- **`.vercel/output/`** is the Build Output API directory `next-on-pages` emits. It is
  not a Vercel deployment and needs no Vercel account, token, or project link.
- **`--branch=main`** is the Cloudflare Pages *production-branch alias*, unrelated to any
  git ref (the stale `main` ref was deleted from both remotes on 2026-09-17). It must
  stay `main`; setting it to `dev` demotes the deploy to a PREVIEW and the custom
  domain silently stops updating.

## Phase spec — other modes

**`--local`** — L1 PRE-FLIGHT (Docker, supabase CLI, node_modules, `supabase/.env`) · L2 SUPABASE RESTART (retries once on health timeout) · L2.5 MIGRATIONS (`migration up --local`, then asserts the local schema is not behind the files on disk — `supabase start` restores a volume backup and does **not** apply pending migrations) · L3 DEV SERVER · L4 READY WAIT · L5 SMOKE (expects `env=local`).

**`--staging`** — same shape as prod against staging targets, no PROMOTE. The staging Supabase project is resolved from `SUPABASE_ACCOUNTS_REGISTRY`; if none is declared, phases 3/3.5 WARN and SKIP — the target is **never** redirected to the prod database. Phase 5 deploys the same Pages project with `--branch=staging` → `staging.paycraft.pages.dev`. On success writes `.state/last-staging.json`, the `--promote-to-prod` precondition.

---

## Output

### Per-phase line

```
[1]   PRE-FLIGHT        ✓ PASS  4.2s
[2]   SECRETS SYNC      ✓ PASS  8.1s   (29 set, 8 skipped → Cloudflare Pages; 8 → Supabase)
[3]   MIGRATIONS        ✓ PASS  3.4s   (0 pending — already current)
[3.5] FUNCTIONS DEPLOY  ✓ PASS  62s    (24 deployed, 0 failed)
[4]   PROMOTE           ↷ SKIP  0s     (retired — dev is the deploy branch)
[5]   DEPLOY CLOUDFLARE ✓ PASS  31s    (paycraft.pages.dev, --branch=main)
[6]   SMOKE             ✓ PASS  6s     (200 OK + /api/health status=ok)
```

### Final summary banner

```
═══════════════════════════════════════════════════════════════
  PayCraft v2.0 — Production Deploy Complete
═══════════════════════════════════════════════════════════════
  Live URL:        https://paycraft.mobilebytesensei.com
  Pages project:   paycraft (alias: paycraft.pages.dev)
  Supabase:        https://mlwfgytjxlqyfxcgpysm.supabase.co
  Env:             production
  Total time:      2m 36s
  Secrets synced:  29 (Cloudflare Pages) + 8 (Supabase Edge)
  Functions:       24 deployed
  Migrations:      0 pending applied

  Next steps:
    - Tail logs:        npx wrangler pages deployment tail --project-name=paycraft
    - Monitor errors:   open https://sentry.io/organizations/<org>/issues/
    - Stripe webhook:   https://paycraft.mobilebytesensei.com/api/webhooks/stripe
    - Razorpay webhook: https://paycraft.mobilebytesensei.com/api/webhooks/razorpay

  Cost ledger updated: infra/deploy/.deploy-ledger.jsonl
═══════════════════════════════════════════════════════════════
```

### Failure banner

```
═══════════════════════════════════════════════════════════════
  PayCraft v2.0 — Deploy ABORTED at phase 3 (MIGRATIONS)
═══════════════════════════════════════════════════════════════
  Failure:    SQL error in 062_upi_payment_intents.sql line 117
  Output:     ERROR:  relation "tenant_products" does not exist
  Likely:     migration 058 was not applied — check supabase_migrations.schema_migrations

  Recovery:
    1. Inspect: supabase migration list --linked
    2. Fix:     supabase db push --linked --debug
    3. Resume:  bash infra/deploy/deploy.sh --apply --from-phase 3

  Earlier phases that completed:
    [1] PRE-FLIGHT     ✓
    [2] SECRETS SYNC   ✓

═══════════════════════════════════════════════════════════════
```

## Idempotence + Resumability

- Each phase writes its completion marker to `infra/deploy/.state/phase-N.done` with timestamp + git SHA
- `--from-phase N` skips phases <N if their .done file exists AND was within last 1h (configurable)
- Stale state markers (>24h) are ignored; phase re-runs
- `--staging` additionally writes `.state/last-staging.json`, which `--promote-to-prod` reads to
  confirm the commit being promoted is the one that was actually rehearsed

## Cost ledger

`infra/deploy/.deploy-ledger.jsonl` (append-only):
```json
{"ts":"2026-09-17T18:30:00Z","env":"production","duration_s":156,"status":"success","phases_run":[1,2,3,3.5,5,6],"secrets_synced":37,"functions_deployed":24,"migrations_applied":0}
```

Use `/release-status` to read ledger.

## Cross-references

- `infra/deploy/deploy.sh` — the orchestrator; its header comment is the phase source of truth
- `dashboard/cloudflare-secrets.map` — alias → env-var map that phase 2 walks
- `.github/workflows/deploy-cloud.yml` — the CI path (triggers on push to `dev`); same ordering, migrations first
- `infra/dns-records.md` — DNS + custom domain reference (Cloudflare; registrar Hostinger)
- `infra/secrets-push-checklist.md` — bootstrap (prereq, not deploy)
- `infra/bootstrap-production.sh` — one-time provisioning (prereq, not deploy)
- `docs/PRODUCTION_LAUNCH_RUNBOOK.md` — manual fallback runbook
- `.claude/skills/paycraft-deploy/SKILL.md` — framework wrapper
- `/release` — generic release framework (PayCraft has its own due to multi-runtime — KMP + dashboard + Supabase + custom domain)

> Removed 2026-09-17: `infra/sync-to-vercel.sh` was listed here as a phase-2 sub-script.
> The file does not exist — phase 2 pushes secrets with `wrangler pages secret put` directly.
