# PayCraft Deploy — Full Workflow Spec

> Loaded by `/paycraft-deploy` skill (framework-level slim wrapper at `.claude/skills/paycraft-deploy/SKILL.md`).
> Orchestrated by `infra/deploy/deploy.sh`.

## Goal

**One command takes a fresh machine to a live PayCraft v2.0 deployment** at `https://paycraft.mobilebytesensei.com`. Fully self-contained — `/paycraft-deploy` detects + auto-fixes everything that CAN be automated (CLI installs, auth, project linking, account checks, vault collection, npm install) and prompts you inline for anything only you can provide (live API keys, OAuth callbacks).

End-state delivered:
- 14 production secrets vaulted + synced (Vercel env + Supabase Edge Function secrets)
- All pending migrations applied to framework-supabase
- Dashboard built + deployed to Vercel production
- Custom domain (`paycraft.mobilebytesensei.com`) attached via Wix DNS + Vercel
- SSL provisioned (Let's Encrypt)
- Health check + Playwright smoke confirming end-to-end up

## Invariants

| ID | Rule |
|---|---|
| D-1 | Dry-run is the default; `--apply` required for mutations (RULE-AUTO-FIX-001) |
| D-2 | Every secret pulled via `secrets-get.sh --to-file` to tmpfile, never stdout (RULE-SECRETS-VAULT-001 SV32) |
| D-3 | Phase 1 (pre-flight) blocks if ANY of 14 secrets missing — no partial deploys |
| D-4 | Phase 8 (health) is a gate — non-200 marks deploy as failed, NOT successful (RULE-VERIFY-COMPLETION-001) |
| D-5 | Resumable from any phase via `--from-phase N` (each phase tracks its own idempotence) |
| D-6 | Per-phase status matrix rendered after every run; final summary banner |
| D-7 | DNS phase (6) tries Wix MCP first if loaded; falls back to user-prompt with exact Wix Dashboard steps |
| D-8 | Refuses to run unless `session-resolve.sh` returns `mbs/PayCraft` |
| D-9 | Production env (default) requires `--apply --confirm-production` two-flag explicit consent |

## CLI

```
deploy.sh [OPTIONS]

Modes:
  --dry-run                     (default) Show what would happen, no mutations
  --apply                       Execute for real (still requires --confirm-production for prod)
  --confirm-production          Required alongside --apply when --env=production

Scoping:
  --env staging|production      Target Vercel env (default: production)
  --from-phase N                Resume from phase N (1..8)
  --to-phase N                  Stop after phase N
  --only-phase N                Run ONLY phase N (alias: --from N --to N)
  --skip-dns                    Skip phases 6 + 7 (if DNS already configured)
  --skip-build                  Skip phase 4 (if you just want to redeploy)

Behavior:
  --keep-going                  Continue past non-critical phase failures (default: abort)
  --verbose                     Print every command being run
  --silent                      Suppress all but errors + final summary
```

## 9-Phase Spec (Phase 0 + Phases 1-8)

### Phase 0 — BOOTSTRAP (auto-install + auto-configure + collect)

The "no-prereqs-needed" phase. Walks each missing prereq to a passing state. Interactive by default; `--non-interactive` mode fails fast on anything needing human input.

Sub-phases (each idempotent):

| Sub | Action | Auto-fix? | Notes |
|---|---|---|---|
| 0.1 | CLI INSTALL | ✅ | `npm i -g vercel`, `brew install supabase/tap/supabase`, `brew install jq`. Falls back to manual instructions if `brew` absent. |
| 0.2 | AUTHENTICATE | ⚠️ semi | Runs `vercel login` + `supabase login` — opens browser, waits for user. |
| 0.3 | PROJECT LINK | ✅ | `vercel link --yes` (dashboard) + `supabase link --project-ref mlwfgytjxlqyfxcgpysm`. |
| 0.4 | ACCOUNTS | ⚠️ semi | Detects missing Resend/Sentry secrets → offers to open signup URLs in browser. |
| 0.5 | SECRETS COLLECT | ⚠️ semi | For each MISSING vault secret: opens provider URL in browser, prompts for hidden-input value, pipes to `secrets-push.sh --stdin`. Skip with `s`. Encryption key auto-generated via `openssl rand`. |
| 0.6 | DASHBOARD NPM | ✅ | `cd dashboard && npm ci` if `node_modules/` missing. |
| 0.7 | SUPABASE REACH | ✅ verify | `curl framework-supabase-url/rest/v1/` smoke. |

Flags: `--check-only` (report what's missing, no fix), `--non-interactive` (fail on human-input needs), `--skip <substep,...>`.

Phase 0 status determines whether Phase 1 can proceed.

### Phase 1 — PRE-FLIGHT

Verifies the deploy can proceed. Hard-fails if ANY check fails.

| Check | Method | Hard? |
|---|---|---|
| Active project = `mbs/PayCraft` | `session-resolve.sh` | YES |
| Git working tree clean (source) | `git status --short` | YES |
| 14 vault secrets present | `secrets-verify.sh --required-for mbs/PayCraft` | YES |
| Vercel CLI installed + logged in | `vercel whoami` | YES |
| Vercel project linked | `dashboard/.vercel/project.json` | YES |
| Supabase CLI installed + logged in | `supabase projects list` | YES |
| Supabase project linked | `supabase status` + ref match | YES |
| framework-supabase reachable | `curl -fsS $FW_SB_URL/rest/v1/` | YES |
| Wix MCP available (informational) | tool list scan for `mcp__wix__*` | NO (logs to phase 6 plan) |
| Node v20+ available | `node --version` | YES |
| Disk space ≥ 5 GB | `df -h .` | YES |

Output: `[1] ✓ PASS  4.2s` or `[1] ✗ FAIL  <reason>`.

### Phase 2 — SECRETS SYNC

Pulls from vault → Vercel + Supabase. Reuses existing scripts.

```bash
bash infra/sync-to-vercel.sh --apply --env "$ENV"
bash infra/sync-to-supabase.sh --apply
```

Each script handles its own per-secret PASS/FAIL/SKIP. Phase fails if either script's exit code ≠ 0.

### Phase 3 — MIGRATIONS

Applies pending migrations to framework-supabase project.

```bash
cd "$PAYCRAFT_SRC"
supabase db push --linked --include-roles
```

Pre-condition: `supabase link --project-ref mlwfgytjxlqyfxcgpysm` ran once.

Phase fails if any migration raises an SQL error. Migrations are forward-only (RULE-SERVER-PROD-PUSH-001 Q8 — no auto-rollback). Manual recovery: `/release-rollback` skill or `supabase db reset` against staging copy.

### Phase 4 — BUILD

Installs deps + production build.

```bash
cd "$PAYCRAFT_SRC/dashboard"
npm ci --no-audit --no-fund
npm run build      # next build — fails on tsc errors
```

Phase fails if `next build` exits non-zero. Build artifacts cached in `.next/` (Vercel re-uses on deploy).

### Phase 5 — DEPLOY

Deploys to Vercel.

```bash
cd "$PAYCRAFT_SRC/dashboard"
VERCEL_TOKEN=$(secrets-get --alias mbs-paycraft-vercel-token --stdout-allowed)
DEPLOY_URL=$(vercel deploy --prod --token "$VERCEL_TOKEN" --yes 2>&1 | tail -1)
echo "$DEPLOY_URL" > infra/deploy/.last-deploy-url
```

`DEPLOY_URL` is the Vercel-assigned URL (e.g. `pay-craft-abc123-mobilebytelabs-projects.vercel.app`). Phase saves it to `.last-deploy-url` for phase 7 + 8.

### Phase 6 — DNS

Verify `paycraft.mobilebytesensei.com` CNAME → `cname.vercel-dns.com`.

**Strategy A — Wix MCP available** (after Claude restart):
```
# Use mcp__wix__* tools:
1. Get site for mobilebytesensei.com
2. List DNS records → find CNAME for "paycraft"
3. If missing: create CNAME paycraft → cname.vercel-dns.com (TTL 3600)
4. If present but value wrong: update
5. Report
```

**Strategy B — Wix MCP unavailable** (current session):
```
Print exact manual steps:
  1. Open https://manage.wix.com/account/sites
  2. Pick mobilebytesensei.com → Domains → Manage DNS Records
  3. Add CNAME record:  host=paycraft  value=cname.vercel-dns.com  TTL=1 Hour
  4. Click Save
Wait for user [Y]es-I-added-it-and-it-resolves confirmation
Verify resolution: dig +short paycraft.mobilebytesensei.com CNAME
```

Phase fails if CNAME doesn't resolve after 60s (DNS propagation slow path).

### Phase 7 — DOMAIN ATTACH

```bash
cd "$PAYCRAFT_SRC/dashboard"
vercel domains add paycraft.mobilebytesensei.com --token "$VERCEL_TOKEN"
# SSL auto-provisioned by Vercel (Let's Encrypt, ~30-90s)
```

Idempotent — already-attached domain is a no-op.

Phase polls Vercel API every 5s up to 90s waiting for SSL cert status = `valid`.

### Phase 8 — HEALTH CHECK

Two checks:

1. **API health endpoint** (if `/api/health` exists in dashboard):
   ```bash
   curl -fsS https://paycraft.mobilebytesensei.com/api/health
   # expect: {"status":"ok","supabase":"reachable","stripe":"reachable"}
   ```

2. **Playwright smoke** (per RULE-WEB-DEBUG-001):
   ```bash
   bash .claude-runtime/scripts/web-debug-bootstrap.sh ensure
   bash .claude-runtime/scripts/web-debug-bootstrap.sh run /tmp/paycraft-smoke.ts
   ```
   The smoke script visits `/auth/login`, asserts presence of Google sign-in button, no console errors.

Phase fails on non-200 or Playwright assert failure.

## Output

### Per-phase line

```
[1] PRE-FLIGHT          ✓ PASS  4.2s
[2] SECRETS SYNC        ✓ PASS  8.1s   (14 secrets → Vercel + 8 → Supabase)
[3] MIGRATIONS          ✓ PASS  3.4s   (0 pending — already current)
[4] BUILD               ✓ PASS  47s    (build size 12 MB)
[5] DEPLOY              ✓ PASS  31s    (https://pay-craft-xyz.vercel.app)
[6] DNS                 ✓ PASS  12s    (CNAME via Wix MCP)
[7] DOMAIN ATTACH       ✓ PASS  44s    (SSL: valid)
[8] HEALTH              ✓ PASS  6s     (200 OK + Playwright smoke clean)
```

### Final summary banner

```
═══════════════════════════════════════════════════════════════
  PayCraft v2.0 — Production Deploy Complete
═══════════════════════════════════════════════════════════════
  Live URL:        https://paycraft.mobilebytesensei.com
  Vercel URL:      https://pay-craft-abc123-mobilebytelabs-projects.vercel.app
  Supabase:        https://mlwfgytjxlqyfxcgpysm.supabase.co
  Env:             production
  Deploy ID:       dpl_xK3p9Lm7Rz...
  Total time:      2m 36s
  Secrets synced:  14 (Vercel) + 8 (Supabase Edge)
  Migrations:      0 pending applied (all caught up to 063)

  Next steps:
    - Tail logs:        vercel logs --token \$VERCEL_TOKEN --follow
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

## Cost ledger

`infra/deploy/.deploy-ledger.jsonl` (append-only):
```json
{"ts":"2026-06-16T18:30:00Z","env":"production","duration_s":156,"deploy_id":"dpl_xK3","status":"success","phases_run":[1,2,3,4,5,6,7,8],"secrets_synced":22,"migrations_applied":0}
```

Use `/release-status` to read ledger.

## Cross-references

- `infra/sync-to-vercel.sh` — phase 2 sub-script
- `infra/sync-to-supabase.sh` — phase 2 sub-script
- `infra/secrets-push-checklist.md` — bootstrap (prereq, not deploy)
- `infra/bootstrap-production.sh` — one-time provisioning (prereq, not deploy)
- `docs/PRODUCTION_LAUNCH_RUNBOOK.md` — manual fallback runbook
- `.claude/skills/paycraft-deploy/SKILL.md` — framework wrapper
- `/release` — generic release framework (PayCraft has its own due to multi-runtime — KMP + dashboard + Supabase + custom domain)
