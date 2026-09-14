#!/usr/bin/env bash
#
# deploy.sh — PayCraft v2.0 unified run/deploy orchestrator.
#
# Four modes, one command:
#
#   --local   Run PayCraft on http://localhost:3000
#             L1 LOCAL PRE-FLIGHT  Docker, supabase CLI, node_modules, supabase/.env
#             L2 SUPABASE RESTART  supabase stop ; supabase start
#             L3 DEV SERVER START  cd dashboard && nohup npm run dev &
#             L4 LOCAL READY WAIT  poll localhost:3000 until 200
#             L5 LOCAL SMOKE       curl /api/health (expects env=local)
#
#   --staging Deploy WHATEVER IS CHECKED OUT — the current branch, including commits not yet on dev.
#             Same phases, staging targets, no PROMOTE: staging is a rehearsal, not a decision.
#             1 PRE-FLIGHT     as prod
#             2 STAGING TARGET resolve the staging Supabase project from SUPABASE_ACCOUNTS_REGISTRY.
#                              None declared → WARN and SKIP phases 3/3.5; the target is never
#                              redirected to the prod database.
#             3 / 3.5          migrations + Edge Functions, against the STAGING project
#             5 DEPLOY CLOUDFLARE  same Pages project, --branch=staging → staging.paycraft.pages.dev
#             6 SMOKE          on success writes .state/last-staging.json (the promote precondition)
#
#   --promote-to-prod  the prod chain, gated on: staging was deployed AND smoked AND HEAD has not
#             moved since. Promoting an un-rehearsed commit is the one thing staging exists to stop.
#
#   --prod    Promote dev → main, then DIRECTLY deploy the dashboard to Cloudflare Workers
#             1 PRE-FLIGHT     verify CLIs/vault/cloudflare/gh; warn on un-pushed dev commits;
#                              TYPECHECK the dashboard (tsc --noEmit) so a broken build never
#                              reaches main (--skip-build to bypass)
#             2 SECRETS SYNC   vault → Cloudflare Worker secrets (best-effort; see phase note)
#             3 MIGRATIONS     detect pending (db push --dry-run) → DESTRUCTIVE-op scan (gated by
#                              --allow-destructive) → pre-push schema BACKUP → supabase db push →
#                              POST-PUSH VERIFY (0 pending). Aborts the chain on any failure.
#             3.5 FUNCTIONS DEPLOY  vault-mediated supabase functions deploy (Edge Functions)
#             4 PROMOTE        open PR dev → main, merge it (fast-forward) — source-of-truth replica
#             5 DEPLOY CLOUDFLARE  build + `npm run cf:deploy` → dashboard on Cloudflare Workers (OpenNext)
#             6 SMOKE          curl /api/health + /auth/login + root + Edge Function /config reachability
#
# Dry-run by default — pass --apply --confirm-production for mutating prod phases. Dry-run still
# runs PRE-FLIGHT (incl. typecheck), the pending-migration list, and the destructive scan.
# Local mode never mutates production state, no --apply needed.
#
# Sub-commands (shorthand aliases):
#   deploy.sh status     emit YAML-like state blob (consumed by SKILL.md matrix)
#   deploy.sh ship       alias for --prod --apply --confirm-production (full prod chain)
#   deploy.sh run        alias for --local
#   deploy.sh verify     alias for --prod --only-phase 1 (preflight + typecheck, read-only)
#   deploy.sh stage      alias for --staging --apply
#   deploy.sh promote    alias for --promote-to-prod --apply --confirm-production
#
# Stability flags:
#   --allow-destructive  permit pending migrations containing DROP/TRUNCATE (audited; default refuse)
#   --skip-build         skip the PRE-FLIGHT dashboard typecheck (not recommended)
#
set -eo pipefail

# ═══════════════════════════════════════════════════════════
# Resolve paths
# ═══════════════════════════════════════════════════════════
PAYCRAFT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FW_ROOT="$(cd "$PAYCRAFT_SRC/../../../../.." && pwd)"
STATE_DIR="$PAYCRAFT_SRC/infra/deploy/.state"
LEDGER="$PAYCRAFT_SRC/infra/deploy/.deploy-ledger.jsonl"
mkdir -p "$STATE_DIR"

PROD_URL="https://paycraft.mobilebytesensei.com"
CF_PAGES_PROJECT="paycraft"   # Cloudflare Pages project (next-on-pages, edge runtime + nodejs_compat)
GITHUB_REPO="MobileByteLabs/PayCraft"
SUPABASE_REF="mlwfgytjxlqyfxcgpysm"

# ── Staging ────────────────────────────────────────────────────────────────────────────────────
# Staging deploys WHATEVER IS CHECKED OUT — the branch you are on, including commits not yet on
# dev. That is the point: you see the change running before deciding it deserves production. So the
# staging chain has no PROMOTE phase; promotion is the separate, deliberate act.
#
# The dashboard rides the same Cloudflare Pages project on a different BRANCH, which gives a stable
# preview host with no new infrastructure. The DATABASE does not get that luxury: a staging deploy
# must never apply migrations to the production project, so the Supabase target is resolved from the
# registry and the run HALTS if no staging project is declared — rather than falling back to prod,
# which is the one failure mode that would make staging worse than useless.
STAGING_BRANCH="staging"
STAGING_URL="https://${STAGING_BRANCH}.${CF_PAGES_PROJECT}.pages.dev"
STAGING_SUPABASE_REF=""       # resolved by resolve_staging_target(); empty = not configured
STAGING_DB_READY=false        # true only when a staging project + db_url alias both resolve

# The Supabase target the migration + function phases act on. Defaults to production; the staging
# chain reassigns all three from the registry BEFORE those phases run, so one set of phases serves
# both environments and neither can drift from the other.
TARGET_DB_URL_ALIAS="framework-supabase-db-url"
TARGET_PAT_ALIAS="framework-supabase-access-token"
TARGET_PROJECT_REF="mlwfgytjxlqyfxcgpysm"
TARGET_URL_ALIAS="framework-supabase-url"
TARGET_ANON_ALIAS="framework-supabase-anon-key"

# ═══════════════════════════════════════════════════════════
# Parse args
# ═══════════════════════════════════════════════════════════
MODE=""                         # "local" | "staging" | "prod" | "" (default: matrix view via SKILL.md)
REQUIRE_STAGED=false            # --promote-to-prod: refuse unless staging was deployed + smoked
APPLY=false
CONFIRM_PROD=false
FROM_PHASE=0   # 0, not 1: --promote-to-prod's STAGED CHECK is phase 0, and a default of 1 made
               # the range check silently skip the one gate that guards production.
TO_PHASE=6
ONLY_PHASE=""
KEEP_GOING=false
VERBOSE=false
SILENT=false
SUB_COMMAND=""
ALLOW_DESTRUCTIVE=false          # gate: pending migrations with DROP/TRUNCATE abort unless set
SKIP_BUILD=false                 # escape hatch: skip the local typecheck in PRE-FLIGHT

# Sub-command detection (shorthand aliases)
case "${1:-}" in
    status|matrix|info)
        SUB_COMMAND="$1"; shift ;;
    ship)
        SUB_COMMAND="ship"; MODE="prod"; APPLY=true; CONFIRM_PROD=true; shift ;;
    run)
        SUB_COMMAND="run"; MODE="local"; shift ;;
    stage)
        # No --confirm-production twin: staging exists to be run freely, and a ceremony on the
        # rehearsal only teaches people to type the ceremony.
        SUB_COMMAND="stage"; MODE="staging"; APPLY=true; shift ;;
    promote)
        SUB_COMMAND="promote"; MODE="prod"; REQUIRE_STAGED=true; APPLY=true; CONFIRM_PROD=true; shift ;;
    verify)
        SUB_COMMAND="verify"; MODE="prod"; ONLY_PHASE=1; FROM_PHASE=1; TO_PHASE=1; shift ;;
esac

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)                MODE="local"; shift ;;
        --prod)                 MODE="prod"; shift ;;
        # `--stagging` is accepted because it is the spelling people reach for; silently, because
        # correcting someone mid-deploy helps nobody.
        --staging|--stagging)   MODE="staging"; shift ;;
        # Promotion is the prod chain with one extra precondition: staging must have actually been
        # deployed and smoke-tested. You cannot promote what you have not staged.
        --promote-to-prod)      MODE="prod"; REQUIRE_STAGED=true; shift ;;
        --apply)                APPLY=true; shift ;;
        --dry-run)              APPLY=false; shift ;;
        --confirm-production)   CONFIRM_PROD=true; shift ;;
        --from-phase)           FROM_PHASE="$2"; shift 2 ;;
        --to-phase)             TO_PHASE="$2"; shift 2 ;;
        --only-phase)           ONLY_PHASE="$2"; FROM_PHASE="$2"; TO_PHASE="$2"; shift 2 ;;
        --keep-going)           KEEP_GOING=true; shift ;;
        --allow-destructive)    ALLOW_DESTRUCTIVE=true; shift ;;
        --skip-build)           SKIP_BUILD=true; shift ;;
        --verbose)              VERBOSE=true; shift ;;
        --silent)               SILENT=true; shift ;;
        -h|--help)
            sed -n '/^# Four modes/,/^set -eo pipefail/p' "${BASH_SOURCE[0]}"

            exit 0 ;;
        *) echo "Unknown flag: $1 — see --help" >&2; exit 1 ;;
    esac
done

# Safety: mutating prod phases require --confirm-production
if [[ "$MODE" = "prod" && "$APPLY" = "true" && "$CONFIRM_PROD" != "true" ]]; then
    echo "ERROR: --apply with --prod requires --confirm-production (safety)" >&2
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════
PHASE_RESULTS=()
START_TS=$(date -u +%s)
PHASE_NS=""; [[ "$MODE" = "staging" ]] && PHASE_NS="staging-"

banner() { [[ "$SILENT" = "true" ]] && return; echo "═══════════════════════════════════════════════════════════════"; printf "  %s\n" "$1"; echo "═══════════════════════════════════════════════════════════════"; }
phase_start() { [[ "$SILENT" = "true" ]] && return; echo ""; echo "▶ Phase $1: $2"; echo "──────────────────────────────────────────────────────"; }
phase_end() {
    local n="$1" name="$2" status="$3" duration="$4" details="${5:-}"
    PHASE_RESULTS+=("$n|$name|$status|$duration|$details")
    [[ "$SILENT" = "true" ]] && return
    local icon
    case "$status" in PASS) icon="✓";; FAIL) icon="✗";; SKIP) icon="↷";; *) icon="?";; esac
    printf "[%s] %-20s %s %s  %ss  %s\n" "$n" "$name" "$icon" "$status" "$duration" "$details"
}

run_phase() {
    local n="$1" name="$2" body="$3"
    if [[ -n "$ONLY_PHASE" && "$n" != "$ONLY_PHASE" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "not in --only-phase"; return 0
    fi
    # Float-safe range check — phase numbers can be non-integer (e.g. 3.5); bash's
    # [[ -lt ]] does integer arithmetic and errors on "3.5". awk handles the compare
    # AND fixes the latent bug where 3.5 ignored --from-phase/--to-phase entirely.
    if awk -v n="$n" -v lo="$FROM_PHASE" -v hi="$TO_PHASE" 'BEGIN{exit !(n+0 < lo+0 || n+0 > hi+0)}'; then
        phase_end "$n" "$name" "SKIP" "0" "out of range"; return 0
    fi
    phase_start "$n" "$name"
    local ts=$(date -u +%s)
    if eval "$body"; then
        local dur=$(($(date -u +%s) - ts))
        phase_end "$n" "$name" "PASS" "$dur"
        # Namespaced by environment: a staging run must not leave a marker that `verify` reads back
        # as "production phase 3 passed". Prod keeps the bare name so existing markers still count.
        echo "$n" > "$STATE_DIR/phase-${PHASE_NS}$n.done"
        return 0
    else
        local rc=$? dur=$(($(date -u +%s) - ts))
        phase_end "$n" "$name" "FAIL" "$dur" "exit=$rc"
        if [[ "$KEEP_GOING" != "true" ]]; then
            failure_banner "$n" "$name" "$rc"; return 1
        fi
        return 0
    fi
}

# (Vercel removed 2026-08-23 — dashboard deploys to Cloudflare Workers; the old
#  vercel_api helper + VERCEL_* project vars are gone.)

# ═══════════════════════════════════════════════════════════
# Phase implementations
# ═══════════════════════════════════════════════════════════
phase_1_preflight() {
    if [[ "$VERBOSE" = "true" ]]; then
        bash "$PAYCRAFT_SRC/infra/deploy/preflight.sh" --verbose || return 1
    else
        bash "$PAYCRAFT_SRC/infra/deploy/preflight.sh" || return 1
    fi

    cd "$PAYCRAFT_SRC"

    # Warn on un-pushed local dev commits — prod promotes origin/dev, so any
    # commit not pushed there will NOT deploy. (Warning only; you may be deploying intentionally.)
    git fetch origin dev 2>/dev/null || true
    local unpushed
    unpushed=$(git rev-list --count origin/dev..dev 2>/dev/null || echo 0)
    if [[ "$unpushed" =~ ^[0-9]+$ && "$unpushed" -gt 0 ]]; then
        echo "  ⚠ local 'dev' is $unpushed commit(s) ahead of origin/dev — those will NOT deploy."
        echo "    Push them first (/git-session-commit) if you intend to ship them."
    fi

    # Build verification — typecheck the dashboard BEFORE any mutation so a broken build never
    # reaches main (Vercel would fail the deploy AFTER promote, polluting main). Fast, deterministic,
    # no env needed. The authoritative Next.js build still runs on Vercel (Phase 5 aborts on ERROR).
    if [[ "$SKIP_BUILD" = "true" ]]; then
        echo "  ↷ build verify skipped (--skip-build)"
        return 0
    fi
    if [[ ! -d "$PAYCRAFT_SRC/dashboard/node_modules" ]]; then
        echo "  ✗ dashboard/node_modules missing — run 'npm ci' in dashboard/ first (or pass --skip-build)"
        return 1
    fi
    echo "  Typechecking dashboard (tsc --noEmit)…"
    local tc_log tc_rc
    tc_log=$(mktemp -t paycraft-tsc-XXXXXX)
    set +o pipefail
    ( cd "$PAYCRAFT_SRC/dashboard" && npx --no-install tsc --noEmit ) > "$tc_log" 2>&1
    tc_rc=$?
    set -o pipefail
    if [[ $tc_rc -eq 0 ]]; then
        echo "  ✓ dashboard typecheck clean"
        rm -f "$tc_log"
    else
        echo "  ✗ dashboard typecheck FAILED — fix before deploying (a broken build would fail the Vercel deploy):"
        grep -E "error TS" "$tc_log" | head -20 || tail -20 "$tc_log"
        rm -f "$tc_log"
        return 1
    fi
}

phase_2_secrets_sync() {
    # Runtime secrets → Cloudflare Worker secrets (migrated off Vercel 2026-08-23).
    # Vault is the SoT: the 15 core runtime secrets already live in the mbs vault
    # with real values (Vercel's prod env is type "Sensitive" = write-only, so it
    # could never be the migration source). The AUTHORITATIVE alias→env-NAME mapping
    # lives in dashboard/cloudflare-secrets.map (handles the dashboard reading names
    # that differ from vault env_var fields + values needed under two names). We loop
    # the map: pull each alias from the vault, `wrangler secret put` it under each
    # env name. An alias that does not resolve (nullable, e.g. STRIPE_CONNECT_CLIENT_ID)
    # is SKIPPED with a warning, never fatal.
    local map="$PAYCRAFT_SRC/dashboard/cloudflare-secrets.map"
    if [[ ! -f "$map" ]]; then
        echo "  ↷ cloudflare-secrets.map not found — skipping (set Worker secrets via Cloudflare dashboard)"; return 0
    fi
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would set these Worker secrets on $CF_WORKER_NAME (value from vault alias):"
        sed -E 's/#.*//; /^[[:space:]]*$/d; s/[[:space:]]//g' "$map" | while IFS='=' read -r env alias; do
            [[ -z "$env" || -z "$alias" ]] && continue
            printf "        %-34s ← %s\n" "$env" "$alias"
        done
        return 0
    fi
    local set=0 skipped=0 failed=0
    while IFS='=' read -r env alias; do
        env="$(echo "$env" | tr -d '[:space:]')"; alias="$(echo "$alias" | tr -d '[:space:]')"
        [[ -z "$env" || -z "$alias" || "$env" == \#* ]] && continue
        local vf; vf=$(mktemp -t cf-sec-XXXXXX); chmod 600 "$vf"
        if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" "$alias" --to-file "$vf" 2>/dev/null || [[ ! -s "$vf" ]]; then
            echo "  ⚠ $env ← $alias : not in vault (skipped — nullable)"; skipped=$((skipped+1)); rm -f "$vf"; continue
        fi
        if ( cd "$PAYCRAFT_SRC/dashboard" && npx --yes wrangler pages secret put "$env" --project-name "$CF_PAGES_PROJECT" < "$vf" >/dev/null 2>&1 ); then
            echo "  ✓ $env ← $alias"; set=$((set+1))
        else
            echo "  ✗ $env ← $alias : wrangler secret put failed (token Workers-scope? Worker exists?)"; failed=$((failed+1))
        fi
        rm -f "$vf"
    done < <(grep -vE '^\s*#' "$map")
    echo "  Worker secrets — set: $set · skipped(nullable): $skipped · failed: $failed"
    [[ "$failed" -eq 0 ]] || echo "  ⚠ some secrets failed — set them via Cloudflare dashboard; deploy continues"
    return 0
}

phase_3_migrations() {
    cd "$PAYCRAFT_SRC"
    local db_url_file db_url
    db_url_file=$(mktemp -t paycraft-dburl-XXXXXX)
    trap "rm -f $db_url_file" RETURN
    if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" "$TARGET_DB_URL_ALIAS" --to-file "$db_url_file" 2>/dev/null; then
        echo "  ✗ $TARGET_DB_URL_ALIAS not resolvable from vault"; return 1
    fi
    db_url=$(cat "$db_url_file")

    # ── Detect pending migrations (ask supabase what it WOULD apply) ──
    local dryrun_log pending dryrun_supported=true
    dryrun_log=$(mktemp -t paycraft-mig-dry-XXXXXX)
    set +o pipefail
    echo y | supabase db push --include-all --dry-run --db-url "$db_url" > "$dryrun_log" 2>&1
    set -o pipefail
    if grep -qiE "unknown flag|unknown shorthand|invalid argument" "$dryrun_log"; then
        dryrun_supported=false  # older CLI without --dry-run; degrade gracefully
    fi
    pending=$(grep -oE '[0-9]{3,}_[a-zA-Z0-9_]+\.sql' "$dryrun_log" | sort -u || true)
    if [[ "$dryrun_supported" = "true" && -z "$pending" ]] && grep -qiE "up to date|no migrations|remote database is up" "$dryrun_log"; then
        echo "  ✓ No pending migrations — remote is up to date."
        rm -f "$dryrun_log"; return 0
    fi
    rm -f "$dryrun_log"
    if [[ -n "$pending" ]]; then
        echo "  Pending migrations:"; echo "$pending" | sed 's/^/    • /'
    else
        echo "  (pending list unavailable on this CLI — relying on push + post-verify)"
    fi

    # ── Destructive-change scan over PENDING files only (data-loss guard) ──
    local DESTRUCTIVE_RE='drop[[:space:]]+table|drop[[:space:]]+column|truncate[[:space:]]|alter[[:space:]]+table[[:space:]].*drop[[:space:]]+column|drop[[:space:]]+type|drop[[:space:]]+schema'
    if [[ -n "$pending" ]]; then
        local destructive=() fname
        while IFS= read -r fname; do
            [[ -z "$fname" ]] && continue
            [[ -f "supabase/migrations/$fname" ]] || continue
            if grep -iqE "$DESTRUCTIVE_RE" "supabase/migrations/$fname"; then destructive+=("$fname"); fi
        done <<< "$pending"
        if [[ ${#destructive[@]} -gt 0 ]]; then
            echo "  ⚠ DESTRUCTIVE operations detected in pending migrations:"
            for fname in "${destructive[@]}"; do
                grep -inE "$DESTRUCTIVE_RE" "supabase/migrations/$fname" | head -4 | sed "s|^|      $fname:|"
            done
            if [[ "$APPLY" = "true" && "$ALLOW_DESTRUCTIVE" != "true" ]]; then
                echo "  ✗ Refusing destructive migrations on ${MODE:-production} without --allow-destructive."
                echo "    If intended, re-run: /paycraft-deploy ship --allow-destructive"
                return 1
            fi
            [[ "$APPLY" = "true" ]] && echo "  ⚠ --allow-destructive set — proceeding (audited)."
        fi
    fi

    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] $([[ -n "$pending" ]] && echo "would apply the pending migrations above" || echo "nothing parsed to apply")"
        return 0
    fi

    # ── Pre-push schema backup (recovery artifact — there is no auto-rollback) ──
    local backup="$STATE_DIR/pre-deploy-schema-$(date -u +%Y%m%dT%H%M%SZ).sql"
    echo "  Backing up remote schema → $backup"
    set +o pipefail
    supabase db dump --db-url "$db_url" -f "$backup" > /dev/null 2>&1
    local dump_rc=$?
    set -o pipefail
    if [[ $dump_rc -eq 0 && -s "$backup" ]]; then
        echo "  ✓ schema backup saved ($(wc -l < "$backup" | tr -d ' ') lines) — restore with: psql <db-url> -f $backup"
    else
        echo "  ⚠ schema backup failed (rc=$dump_rc) — continuing, but no pre-migration snapshot exists."
        rm -f "$backup"
    fi

    # ── Apply (echo y, not yes — yes triggers SIGPIPE/141 under pipefail) ──
    echo "  Running: supabase db push --include-all --db-url <framework-supabase>"
    local push_log push_rc
    push_log=$(mktemp -t paycraft-dbpush-XXXXXX)
    set +o pipefail
    echo y | supabase db push --include-all --db-url "$db_url" --include-roles > "$push_log" 2>&1
    push_rc=$?
    set -o pipefail
    if [[ $push_rc -ne 0 ]]; then
        tail -30 "$push_log"; rm -f "$push_log"
        echo "  ✗ migration push failed — remote may be partially migrated. Backup: ${backup:-none}"
        return $push_rc
    fi
    tail -15 "$push_log"; rm -f "$push_log"

    # ── Post-push verification: assert NOTHING is still pending ──
    if [[ "$dryrun_supported" = "true" ]]; then
        local verify_log still
        verify_log=$(mktemp -t paycraft-mig-verify-XXXXXX)
        set +o pipefail
        echo y | supabase db push --include-all --dry-run --db-url "$db_url" > "$verify_log" 2>&1
        set -o pipefail
        still=$(grep -oE '[0-9]{3,}_[a-zA-Z0-9_]+\.sql' "$verify_log" | sort -u || true)
        rm -f "$verify_log"
        if [[ -n "$still" ]]; then
            echo "  ✗ Post-push verification FAILED — still pending after push:"; echo "$still" | sed 's/^/    • /'
            return 1
        fi
        echo "  ✓ Post-push verification: all migrations applied (0 pending)."
    fi
}

# Phase 3.5 — deploy Edge Functions to framework-supabase
# Resolves framework-supabase-personal-access-token (account-level PAT) from the vault to
# authenticate the CLI against the Supabase Management API. Deploys EVERY function
# under supabase/functions/ except _shared (which is a Deno deps directory, not a
# function). Idempotent — re-running redeploys the same function code.
# Uses the canonical framework-supabase group alias (same group as
# framework-supabase-{url,anon-key,service-role-key,db-url}) — one PAT covers
# every framework-supabase consumer that needs to deploy Edge Functions.
phase_3_5_functions() {
    cd "$PAYCRAFT_SRC"
    local pat_file pat
    pat_file=$(mktemp -t fw-supabase-pat-XXXXXX)
    trap "rm -f $pat_file" RETURN
    # `framework-supabase-access-token` is the REGISTERED alias (SECRETS_ALIAS_REGISTRY.yaml,
    # env_var SUPABASE_ACCESS_TOKEN, provider https://supabase.com/dashboard/account/tokens).
    # This asked for `framework-supabase-personal-access-token`, a name that appears ZERO times in
    # the registry — so it could never resolve, and the failure message told the operator to add a
    # secret they already had under its real name. RULE-SECRETS-NAMING-CONVENTION-001 NC2: every
    # alias a consumer requests must be one the registry declares.
    if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" "$TARGET_PAT_ALIAS" --to-file "$pat_file" 2>/dev/null; then
        echo "  ✗ $TARGET_PAT_ALIAS not resolvable from vault"
        echo "    Add via: /secrets handoff paste --id framework-supabase-access-token --kind env_var"
        echo "    See: https://supabase.com/dashboard/account/tokens"
        return 1
    fi
    pat=$(cat "$pat_file")
    export SUPABASE_ACCESS_TOKEN="$pat"
    local project_ref="$TARGET_PROJECT_REF"
    local functions=()
    for d in supabase/functions/*/; do
        local name=$(basename "$d")
        [[ "$name" = "_shared" ]] && continue
        # A deployable function IS its `index.ts`. `__tests__/` holds canary subdirectories and no
        # entrypoint, so every run reported it as a failed deploy — a permanent "2 function(s)
        # failed" on an otherwise clean deploy, which is how a real failure gets ignored. Skipping
        # by entrypoint rather than by name also covers the next test/helper directory someone adds.
        [[ -f "${d}index.ts" ]] || { echo "  ↷ ${name}: no index.ts — not a function, skipped"; continue; }
        functions+=("$name")
    done
    echo "  Functions: ${functions[*]}"
    if [[ "$APPLY" = "true" ]]; then
        local fn_log fn_rc fail_count=0 fail_list=()
        for fn in "${functions[@]}"; do
            echo "  Deploying $fn..."
            fn_log=$(mktemp -t paycraft-fn-XXXXXX)
            set +o pipefail
            supabase functions deploy "$fn" --project-ref "$project_ref" > "$fn_log" 2>&1
            fn_rc=$?
            set -o pipefail
            tail -5 "$fn_log"
            if [[ $fn_rc -ne 0 ]]; then
                fail_count=$((fail_count + 1))
                fail_list+=("$fn")
                echo "  ⚠ deploy failed: $fn (continuing)"
            fi
            rm -f "$fn_log"
        done
        if [[ $fail_count -gt 0 ]]; then
            echo "  ⚠ $fail_count function(s) failed to deploy: ${fail_list[*]}"
            echo "  ✓ remaining ${#functions[@]} functions deployed successfully"
            # Don't abort the phase — partial deploy is acceptable; the failing
            # functions surface in the dashboard for follow-up. Returning 0
            # lets the chain proceed to PROMOTE.
        fi
    else
        echo "  [DRY] would deploy ${#functions[@]} function(s) to project $project_ref"
    fi
    unset SUPABASE_ACCESS_TOKEN
}

# Phase 4 — promote dev → main as exact fast-forward replica
phase_4_promote() {
    cd "$PAYCRAFT_SRC"

    # Ensure local main + dev are up to date
    git fetch origin dev main 2>/dev/null

    local dev_sha main_sha
    dev_sha=$(git rev-parse origin/dev)
    main_sha=$(git rev-parse origin/main)

    if [[ "$dev_sha" = "$main_sha" ]]; then
        echo "  ✓ main already at dev HEAD ($dev_sha) — nothing to promote"
        return 0
    fi

    echo "  dev: $dev_sha"
    echo "  main:        $main_sha"
    echo "  Promoting dev → main..."

    if [[ "$APPLY" != "true" ]]; then
        local ahead
        ahead=$(git rev-list --count origin/main..origin/dev)
        echo "  [DRY] would open PR dev → main ($ahead commits ahead)"
        echo "  [DRY] would auto-merge with --merge to keep main = dev"
        return 0
    fi

    # Check for an existing open dev→main PR; reuse if present
    local pr_num
    pr_num=$(gh pr list --base main --head dev --state open --json number --jq '.[0].number // empty' 2>/dev/null)
    if [[ -z "$pr_num" ]]; then
        echo "  Opening PR dev → main..."
        pr_num=$(gh pr create --base main --head dev \
            --title "release: promote dev → main ($(date -u +%Y-%m-%dT%H:%M:%SZ))" \
            --body "Auto-opened by /paycraft-deploy Phase 4 PROMOTE.

Source: origin/dev @ ${dev_sha}
Target: origin/main @ ${main_sha}
Diff:   $(git rev-list --count origin/main..origin/dev) commits

This PR is fast-forward-only — main is kept as an exact replica of dev at promote time. No manual edits should land on main." 2>&1 | grep -oE 'https://[^ ]+/[0-9]+' | grep -oE '[0-9]+$' | head -1)
        if [[ -z "$pr_num" ]]; then
            echo "  ✗ Failed to open PR"; return 1
        fi
        echo "  ✓ Opened PR #${pr_num}"
    else
        echo "  ✓ Reusing existing PR #${pr_num}"
    fi

    # Auto-merge: prefer --merge (preserves history); GitHub falls back to required strategy if --merge disabled
    echo "  Merging PR #${pr_num}..."
    if gh pr merge "$pr_num" --merge --delete-branch=false 2>&1 | head -3; then
        echo "  ✓ PR #${pr_num} merged"
    else
        echo "  ⚠ --merge strategy unavailable; falling back to --squash"
        gh pr merge "$pr_num" --squash --delete-branch=false 2>&1 | head -3 \
            || { echo "  ✗ Merge failed"; return 1; }
    fi

    # Refresh local state and confirm
    git fetch origin main 2>/dev/null
    local new_main_sha
    new_main_sha=$(git rev-parse origin/main)
    echo "  main HEAD now: $new_main_sha"
    echo "$new_main_sha" > "$STATE_DIR/last-promoted-sha"
}

# Phase 5 — poll Vercel API until the deploy of the latest main commit is READY
# Phase 5 — DIRECT deploy the dashboard to Cloudflare Workers (OpenNext).
# Migrated off Vercel auto-deploy (2026-08-23): the dashboard runs on Cloudflare
# Workers via @opennextjs/cloudflare, so prod deploy is a direct build+push we own
# — no waiting on an external CI/Vercel webhook. `npm run cf:deploy` =
# `opennextjs-cloudflare build && … deploy` (reads CLOUDFLARE_ACCOUNT_ID +
# CLOUDFLARE_API_TOKEN, pulled SV32-safe from the vault).
phase_5_deploy_cloudflare() {
    local dash="$PAYCRAFT_SRC/dashboard"
    # One phase, two branches of the SAME Pages project. Staging used to have its own copy of this
    # function, which is how it lost the vault creds and the NEXT_PUBLIC_* materialization below and
    # would have shipped a bundle pointing at whatever .env.local the operator happened to have.
    local deploy_branch="main" public_url="$PROD_URL" label="production"
    if [[ "$MODE" = "staging" ]]; then
        deploy_branch="$STAGING_BRANCH"; public_url="$STAGING_URL"; label="staging"
    fi
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would build + deploy dashboard → Cloudflare Pages branch '$deploy_branch' ($public_url)"
        return 0
    fi
    command -v npx >/dev/null 2>&1 || { echo "  ✗ node/npx required for cf:deploy"; return 1; }
    # next-on-pages Pages deploys don't require a repo wrangler.jsonc — the
    # `nodejs_compat` compatibility flag lives in the Cloudflare Pages project
    # settings (the migration off OpenNext/Workers removed the Workers-format
    # wrangler.jsonc on purpose). Treat its absence as informational, not fatal.
    [[ -f "$dash/wrangler.jsonc" ]] || echo "  ↷ no dashboard/wrangler.jsonc — relying on Pages project settings (nodejs_compat)"

    # Pull Cloudflare creds from the vault (SV32-safe; tmpfiles shredded on return).
    local tmpd; tmpd=$(mktemp -d); trap 'rm -rf "$tmpd" 2>/dev/null' RETURN
    bash "$FW_ROOT/core/scripts/secrets-get.sh" mbs-cloudflare-account-id      --to-file "$tmpd/acct" 2>/dev/null || { echo "  ✗ vault pull: mbs-cloudflare-account-id"; return 1; }
    bash "$FW_ROOT/core/scripts/secrets-get.sh" mbs-cloudflare-pages-api-token --to-file "$tmpd/tok"  2>/dev/null || { echo "  ✗ vault pull: mbs-cloudflare-pages-api-token"; return 1; }

    # CRITICAL: Next.js INLINES every `process.env.NEXT_PUBLIC_*` at BUILD time.
    # A developer's `.env.local` (local Supabase http://127.0.0.1:54321) would bake
    # LOCAL urls into the PROD Worker bundle → runtime Supabase calls hit 127.0.0.1
    # and fail instantly. So materialize the PROD public values from the vault into
    # `.env.production.local` (Next precedence: .env.production.local > .env.local)
    # right before the build. Gitignored via dashboard/.gitignore `.env*.local`.
    local ep="$dash/.env.production.local"
    : > "$ep"; chmod 600 "$ep"
    bash "$FW_ROOT/core/scripts/secrets-get.sh" "$TARGET_URL_ALIAS"  --to-file "$tmpd/sburl" 2>/dev/null || { echo "  ✗ vault pull: $TARGET_URL_ALIAS"; return 1; }
    bash "$FW_ROOT/core/scripts/secrets-get.sh" "$TARGET_ANON_ALIAS" --to-file "$tmpd/sbanon" 2>/dev/null || { echo "  ✗ vault pull: $TARGET_ANON_ALIAS"; return 1; }
    {
        printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n'          "$(cat "$tmpd/sburl")"
        printf 'NEXT_PUBLIC_PAYCRAFT_SUPABASE_URL=%s\n' "$(cat "$tmpd/sburl")"
        printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n'     "$(cat "$tmpd/sbanon")"
        printf 'NEXT_PUBLIC_PAYCRAFT_DASHBOARD_URL=%s\n' "$public_url"
    } >> "$ep"
    echo "  ✓ ${label} build-time env materialized → .env.production.local ($TARGET_URL_ALIAS, $TARGET_ANON_ALIAS)"

    echo "  Building + deploying dashboard → Cloudflare Pages branch '$deploy_branch' (next-on-pages, edge)…"
    [[ -d "$dash/node_modules" ]] || ( cd "$dash" && npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 )
    # `npm run pages:deploy` hardcodes --branch=main, so staging spells the two steps out rather
    # than passing a branch the script would ignore. Same binaries, same artifact directory.
    if ( cd "$dash" \
          && export CLOUDFLARE_ACCOUNT_ID="$(cat "$tmpd/acct")" \
                    CLOUDFLARE_API_TOKEN="$(cat "$tmpd/tok")" \
          && if [[ "$deploy_branch" = "main" ]]; then
                 npm run pages:deploy
             else
                 npx @cloudflare/next-on-pages@1 \
                   && npx wrangler pages deploy .vercel/output/static \
                        --project-name="$CF_PAGES_PROJECT" --branch="$deploy_branch"
             fi ); then
        echo "  ✓ Dashboard deployed to Cloudflare Pages ($CF_PAGES_PROJECT, branch $deploy_branch → $public_url)"
        [[ "$MODE" = "staging" ]] || echo "$PROD_URL" > "$STATE_DIR/last-deploy-url"
        return 0
    fi
    echo "  ✗ pages:deploy failed — check next-on-pages/wrangler output above (edge-runtime on all routes? nodejs_compat set? token Pages-scope?)"
    return 1
}

phase_6_smoke() {
    echo "  Target: ${PROD_URL}"
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would curl ${PROD_URL}/ + /api/health + /auth/login"
        return 0
    fi

    local fails=0 result
    # Root
    result=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 10 "${PROD_URL}/" 2>&1) || true
    if [[ "$result" =~ ^(200|307|308)$ ]]; then echo "  ✓ Root URL → HTTP $result"; else echo "  ✗ Root URL → HTTP $result"; fails=$((fails+1)); fi

    # Health
    result=$(curl -sS -o /tmp/.health.json -w "%{http_code}" --max-time 10 "${PROD_URL}/api/health" 2>&1) || true
    if [[ "$result" = "200" ]]; then
        local status
        status=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/.health.json','utf-8')).status)" 2>/dev/null)
        if [[ "$status" = "ok" ]]; then echo "  ✓ /api/health → status=ok"; else echo "  ⚠ /api/health → 200 but status=$status (degraded)"; fi
    else
        echo "  ✗ /api/health → HTTP $result"; fails=$((fails+1))
    fi

    # Login page renders
    result=$(curl -fsS -o /tmp/.login.html -w "%{http_code}" --max-time 10 "${PROD_URL}/auth/login" 2>&1) || true
    if [[ "$result" = "200" ]] && grep -qE "sign[- ]?in|login|google|email" /tmp/.login.html; then
        echo "  ✓ /auth/login renders (HTTP 200, contains auth markers)"
    else
        echo "  ⚠ /auth/login HTTP $result — may not contain expected markers"
    fi

    # Edge Function reachability — /config is the SDK's critical endpoint. No-auth probe:
    # 401 = function deployed & auth-gated (correct); 404 = NOT deployed.
    result=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "https://${SUPABASE_REF}.supabase.co/functions/v1/config" 2>&1) || true
    if [[ "$result" =~ ^(401|200)$ ]]; then
        echo "  ✓ Edge Function /config reachable (HTTP $result — deployed)"
    else
        echo "  ✗ Edge Function /config → HTTP $result (404 = not deployed)"; fails=$((fails+1))
    fi
    rm -f /tmp/.health.json /tmp/.login.html

    [[ $fails -eq 0 ]]
}

# ═══════════════════════════════════════════════════════════
# Status sub-command (consumed by SKILL.md matrix)
# ═══════════════════════════════════════════════════════════
emit_status() {
    echo "─── env ─────────────────────────────────────────────"
    printf "active_project: %s\n" "$(bash $FW_ROOT/core/scripts/session-resolve.sh 2>/dev/null || echo unknown)"
    printf "target_env:     production\n"
    printf "dashboard_path: %s/dashboard\n" "$PAYCRAFT_SRC"
    printf "framework_supabase_project_ref: %s\n" "$SUPABASE_REF"
    echo ""

    echo "─── prereqs ────────────────────────────────────────"
    printf "cli_wrangler:  %s\n"   "$(command -v npx >/dev/null && echo AVAILABLE || echo MISSING)"
    printf "cli_supabase:  %s\n"   "$(command -v supabase >/dev/null && echo INSTALLED || echo MISSING)"
    printf "cli_gh:        %s\n"   "$(command -v gh >/dev/null && echo INSTALLED || echo MISSING)"
    printf "auth_gh:       %s\n"   "$(gh auth status 2>&1 | grep -oE 'Logged in to github.com as [^ ]+' | head -1 || echo NOT-LOGGED-IN)"
    printf "cf_worker_cfg: %s\n"   "$([ -f $PAYCRAFT_SRC/dashboard/wrangler.jsonc ] && echo CONFIGURED || echo MISSING)"
    echo ""

    echo "─── vault (Cloudflare deploy + framework-supabase) ──"
    local SECRETS=(
        paycraft-encryption-key
        mbs-cloudflare-account-id
        mbs-cloudflare-pages-api-token
        framework-supabase-personal-access-token
    )
    local total=0 present=0 missing=()
    for a in "${SECRETS[@]}"; do
        total=$((total + 1))
        local chk; chk=$(mktemp -t v-chk-XXXXXX); chmod 600 "$chk"
        if bash "$FW_ROOT/core/scripts/secrets-get.sh" "$a" --to-file "$chk" 2>/dev/null; then
            present=$((present + 1))
        else
            missing+=("$a")
        fi
        rm -f "$chk"
    done
    printf "vault_present: %d\n" "$present"
    printf "vault_missing: %d\n" "${#missing[@]}"
    printf "vault_total:   %d\n" "$total"
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "vault_missing_list:"
        for m in "${missing[@]}"; do printf "  - %s\n" "$m"; done
    fi
    echo ""

    echo "─── branches ───────────────────────────────────────"
    cd "$PAYCRAFT_SRC"
    git fetch -q origin dev main 2>/dev/null || true
    local dev_sha main_sha ahead
    dev_sha=$(git rev-parse --short origin/dev 2>/dev/null || echo "?")
    main_sha=$(git rev-parse --short origin/main 2>/dev/null || echo "?")
    ahead=$(git rev-list --count origin/main..origin/dev 2>/dev/null || echo "?")
    printf "dev:   %s\n" "$dev_sha"
    printf "main:          %s\n" "$main_sha"
    printf "ahead:         %s commits (dev ahead of main)\n" "$ahead"
    if [[ "$dev_sha" = "$main_sha" ]]; then
        printf "promote_state: SYNCED\n"
    else
        printf "promote_state: PENDING (run Phase 4 to promote)\n"
    fi
    echo ""

    echo "─── phases ─────────────────────────────────────────"
    for n in 1 2 3 4 5 6; do
        local name
        case "$n" in
            1) name="PRE-FLIGHT" ;; 2) name="SECRETS SYNC" ;;
            3) name="MIGRATIONS" ;; 3.5) name="FUNCTIONS DEPLOY" ;;
            4) name="PROMOTE" ;; 5) name="DEPLOY CLOUDFLARE" ;; 6) name="SMOKE" ;;
        esac
        local marker="$STATE_DIR/phase-$n.done"
        if [[ -f "$marker" ]]; then
            printf "phase_%d: PASS %s\n" "$n" "$name"
        else
            printf "phase_%d: NOT-RUN %s\n" "$n" "$name"
        fi
    done
    echo ""

    echo "─── live state ─────────────────────────────────────"
    local live_status="?"
    live_status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$PROD_URL/" 2>&1) || live_status="unreachable"
    printf "live_url:    %s\n" "$PROD_URL"
    printf "health_http: %s\n" "$live_status"
    if [[ -f "$STATE_DIR/last-deploy-url" ]]; then
        printf "last_deploy_url: https://%s\n" "$(cat $STATE_DIR/last-deploy-url)"
    fi
    echo ""

    echo "─── ledger (tail 3) ────────────────────────────────"
    [[ -f "$LEDGER" ]] && tail -3 "$LEDGER" || echo "(empty)"
}

# ═══════════════════════════════════════════════════════════
# Failure banner
# ═══════════════════════════════════════════════════════════
failure_banner() {
    local n="$1" name="$2" rc="$3"
    banner "PayCraft Deploy — ABORTED at phase $n ($name)"
    echo "  Phase failed with exit code: $rc"
    echo "  Total time so far:           $(($(date -u +%s) - START_TS))s"
    echo ""
    echo "  Phases completed:"
    for r in "${PHASE_RESULTS[@]}"; do
        IFS='|' read -r rn rname rstatus rdur rdetails <<< "$r"
        # %s, not %d — phase 3.5 is not an integer, and printing the completed-phase list is the
        # one moment an operator needs it exact: a failed run reported "[3] FUNCTIONS DEPLOY",
        # naming a phase that had NOT just run and hiding which one actually had.
        [[ "$rstatus" = "PASS" ]] && printf "    [%s] %-20s ✓ PASS  %ss\n" "$rn" "$rname" "$rdur"
    done
    echo ""
    echo "  Resume after fix:"
    if [[ "$MODE" = "staging" ]]; then
        echo "    bash infra/deploy/deploy.sh --staging --apply --from-phase $n"
    else
        echo "    bash infra/deploy/deploy.sh --apply --confirm-production --from-phase $n"
    fi
    echo "═══════════════════════════════════════════════════════════════"

    # %s, not %d: phases are not all integers — 3.5 (FUNCTIONS DEPLOY) made printf fail with
    # "invalid number" and write a malformed ledger line at the exact moment the ledger matters,
    # i.e. when a production deploy has just aborted. The field is quoted in the JSON anyway.
    printf '{"ts":"%s","env":"production","status":"aborted","duration_s":%d,"failed_phase":"%s","apply":%s}\n' \
        "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" "$n" "$APPLY" >> "$LEDGER"
}

# ═══════════════════════════════════════════════════════════
# LOCAL-mode phases (--local / `run`)
# ═══════════════════════════════════════════════════════════
LOCAL_URL="http://localhost:3000"
LOCAL_SB_API="http://localhost:54321"
LOCAL_SB_STUDIO="http://localhost:54323"
DEV_LOG="$STATE_DIR/dev-server.log"
DEV_PID_FILE="$STATE_DIR/dev-server.pid"

phase_local_1_preflight() {
    local fails=0
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        echo "  ✓ Docker daemon running"
    else
        echo "  ✗ Docker not running (supabase start requires Docker)"; fails=$((fails+1))
    fi
    command -v supabase >/dev/null && echo "  ✓ Supabase CLI installed" \
        || { echo "  ✗ Supabase CLI missing (brew install supabase/tap/supabase)"; fails=$((fails+1)); }
    command -v node >/dev/null && [ "$(node -v | sed 's/v//' | cut -d. -f1)" -ge 20 ] \
        && echo "  ✓ Node v20+ available" \
        || { echo "  ✗ Node v20+ required"; fails=$((fails+1)); }
    [ -d "$PAYCRAFT_SRC/dashboard/node_modules" ] \
        && echo "  ✓ dashboard/node_modules present" \
        || { echo "  ⚠ dashboard/node_modules missing — running npm install"; (cd "$PAYCRAFT_SRC/dashboard" && npm install --no-audit --no-fund 2>&1 | tail -3); }
    [ -f "$PAYCRAFT_SRC/supabase/.env" ] \
        && echo "  ✓ supabase/.env present (Google OAuth wired)" \
        || echo "  ⚠ supabase/.env missing — Google OAuth will use Supabase defaults"
    [[ $fails -eq 0 ]]
}

phase_local_2_supabase_restart() {
    cd "$PAYCRAFT_SRC"
    echo "  Stopping any running Supabase stack..."
    supabase stop 2>&1 | tail -3 || true
    echo "  Starting Supabase (this can take 30-60s on first run)..."
    supabase start 2>&1 | tail -20
}

phase_local_3_dev_server() {
    cd "$PAYCRAFT_SRC/dashboard"
    # Kill any process on port 3000
    if lsof -ti:3000 >/dev/null 2>&1; then
        echo "  Killing existing process on :3000..."
        lsof -ti:3000 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    echo "  Starting Next.js dev server (logs → $DEV_LOG)..."
    nohup npm run dev > "$DEV_LOG" 2>&1 &
    local pid=$!
    echo "$pid" > "$DEV_PID_FILE"
    disown
    echo "  Dev server PID: $pid"
}

phase_local_4_ready_wait() {
    echo "  Waiting for http://localhost:3000 to respond..."
    local start=$(date +%s); local deadline=$((start + 90))
    while [[ $(date +%s) -lt $deadline ]]; do
        if curl -fsS -o /dev/null --max-time 2 "$LOCAL_URL/" 2>/dev/null; then
            echo "  ✓ Dev server ready in $(($(date +%s) - start))s"
            return 0
        fi
        sleep 1
    done
    echo "  ✗ Dev server did not respond within 90s — check $DEV_LOG"
    tail -20 "$DEV_LOG" 2>/dev/null | sed 's/^/    /'
    return 1
}

phase_local_5_smoke() {
    local result
    result=$(curl -sS -o /tmp/.lhealth.json -w "%{http_code}" --max-time 5 "$LOCAL_URL/api/health" 2>&1) || true
    if [[ "$result" = "200" ]]; then
        local status env
        status=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/.lhealth.json','utf-8')).status)" 2>/dev/null)
        env=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/.lhealth.json','utf-8')).env)" 2>/dev/null)
        echo "  ✓ /api/health → status=$status  env=$env"
    else
        echo "  ⚠ /api/health → HTTP $result (dev server up but endpoint may not be reachable yet)"
    fi
    rm -f /tmp/.lhealth.json
}

# ═══════════════════════════════════════════════════════════
# Main dispatch
# ═══════════════════════════════════════════════════════════
if [[ "$SUB_COMMAND" = "status" || "$SUB_COMMAND" = "matrix" || "$SUB_COMMAND" = "info" ]]; then
    emit_status
    exit 0
fi

if [[ -z "$MODE" ]]; then
    echo "ERROR: pick a mode — --local or --prod  (or 'run' / 'ship')" >&2
    echo "  /paycraft-deploy --local        run locally on http://localhost:3000" >&2
    echo "  /paycraft-deploy --prod         dry-run the prod chain (no mutations)" >&2
    echo "  /paycraft-deploy --prod --apply --confirm-production  full prod deploy" >&2
    echo "  /paycraft-deploy ship           shorthand for the full prod deploy" >&2
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# Staging target resolution + staging-only phases
# ═══════════════════════════════════════════════════════════

# Resolve the STAGING Supabase project from the registry — never a fallback to prod.
#
# A staging deploy that silently ran its migrations against the production database would be worse
# than having no staging at all: it would carry the confidence of a rehearsal with the blast radius
# of the real thing. So an unconfigured staging project is a HARD stop with the exact remediation.
resolve_staging_target() {
    local fw="$FW_ROOT" reg acct
    reg="$fw/core/registries/SUPABASE_ACCOUNTS_REGISTRY.yaml"
    acct="$(yq -r '.supabase.account // ""' "$fw/workspaces/mbs/PayCraft/secrets-manifest.yaml" 2>/dev/null)"
    local row
    row="$(A="$acct" yq -r \
        '.accounts[strenv(A)] as $a | $a.projects | to_entries[] | select(.value.environment == "staging")
         | [.value.project_ref, (.value.secret_aliases.db_url // ""), ($a.access_token_alias // ""),
            (.value.secret_aliases.url // ""), (.value.secret_aliases.anon // "")] | @tsv' \
        "$reg" 2>/dev/null | head -1)"
    STAGING_SUPABASE_REF="$(echo "$row" | cut -f1)"
    local db_alias pat_alias
    db_alias="$(echo "$row" | cut -f2)"; pat_alias="$(echo "$row" | cut -f3)"

    # Missing staging DB disables the DB phases; it does not abort the deploy.
    #
    # The two halves of a staging run carry completely different risk. Publishing the dashboard to a
    # preview branch is reversible and is the whole reason to stage at all — you want to click
    # through the branch you are on. Running migrations is not reversible, and running them against
    # the PRODUCTION billing database while the output says "staging" is the single worst thing this
    # script could do. So the missing-project case skips phases 3 and 3.5 and still deploys the
    # dashboard, rather than blocking the safe half to guard the dangerous one.
    if [[ -z "$STAGING_SUPABASE_REF" || "$STAGING_SUPABASE_REF" = "null" || -z "$db_alias" ]]; then
        STAGING_DB_READY=false
        local why="no project with environment: staging"
        [[ -n "$STAGING_SUPABASE_REF" && "$STAGING_SUPABASE_REF" != "null" && -z "$db_alias" ]] \
            && why="project $STAGING_SUPABASE_REF declares no secret_aliases.db_url"
        cat <<EOF
  ⚠ NO STAGING DATABASE — $why for account '${acct:-<unresolved>}'.

    → MIGRATIONS + FUNCTIONS phases are SKIPPED this run. They will NOT be redirected to the
      production project; a run that migrated the live billing database while reporting "staging"
      is the exact failure this refuses to commit.
    → The dashboard still deploys to $STAGING_URL, reading the PRODUCTION Supabase.
      Treat what you see there as live data: it is.

    To get a real staging database, create a project in the same Supabase account, then add to
    core/registries/SUPABASE_ACCOUNTS_REGISTRY.yaml under accounts.${acct:-<account>}.projects:

        paycraft-staging:
          project_ref: <ref>
          environment: staging
          consumers: [mbs/PayCraft]
          secret_aliases: { url: …, anon: …, service_role: …, db_url: … }
EOF
        return 0
    fi
    STAGING_DB_READY=true
    # Point the shared migration + function phases at staging. Assigned HERE, before either phase
    # runs, so there is no window in which a staging chain could touch the production database.
    TARGET_PROJECT_REF="$STAGING_SUPABASE_REF"
    TARGET_DB_URL_ALIAS="$db_alias"
    [[ -n "$pat_alias" ]] && TARGET_PAT_ALIAS="$pat_alias"
    # The dashboard bundle must point at the same database the migrations went to, or the preview
    # shows staging's schema over production's rows.
    local url_alias anon_alias
    url_alias="$(echo "$row" | cut -f4)"; anon_alias="$(echo "$row" | cut -f5)"
    [[ -n "$url_alias"  ]] && TARGET_URL_ALIAS="$url_alias"
    [[ -n "$anon_alias" ]] && TARGET_ANON_ALIAS="$anon_alias"
    echo "  ✓ staging Supabase: $STAGING_SUPABASE_REF (db: $TARGET_DB_URL_ALIAS, pat: $TARGET_PAT_ALIAS)"
    return 0
}

phase_s1_resolve() { resolve_staging_target; }

# Phase 2.5 — make sure the staging origin is an allowed auth redirect.
#
# The decision logic lives in lib-auth-allowlist.sh (canary:
# tests/auth-allowlist-canary/run.sh) so it is testable without a project, a PAT, or a network.
# This function is only the I/O around it: read the config, PATCH it back.
#
# site_url is never touched — production stays the fallback for anything genuinely unrecognized.
phase_s2_5_auth_allowlist() {
    . "$PAYCRAFT_SRC/infra/deploy/lib-auth-allowlist.sh"
    local ref="${TARGET_PROJECT_REF}" raw cur m
    echo "  Auth project: $ref$([[ "$STAGING_DB_READY" = "true" ]] || echo "  (PRODUCTION — no staging DB)")"

    raw="$(bash "$FW_ROOT/core/scripts/supabase-connect.sh" mgmt GET "projects/$ref/config/auth" \
            --target mbs/PayCraft 2>/dev/null)"
    cur="$(parse_uri_allow_list "$raw")"
    if [[ -z "$cur" ]]; then
        # Empty means "could not read", NOT "the list is empty" — PATCHing an empty list back would
        # delete every existing redirect, including production's. Unverifiable, so say so and stop
        # short of writing.
        echo "  ⚠ could not read uri_allow_list for $ref — not writing."
        echo "    Staging sign-in may bounce to production; verify in Supabase → Auth → URL Configuration."
        return 0
    fi

    local missing=()
    while IFS= read -r m; do [[ -n "$m" ]] && missing+=("$m"); done \
        < <(auth_allowlist_missing "$cur" "$STAGING_URL" "$CF_PAGES_PROJECT")

    if [[ ${#missing[@]} -eq 0 ]]; then
        echo "  ✓ staging origin already an allowed auth redirect"
        return 0
    fi
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would add to uri_allow_list: ${missing[*]}"
        return 0
    fi

    local next; next="$(allowlist_join "$cur" "${missing[@]}")"
    if bash "$FW_ROOT/core/scripts/supabase-connect.sh" mgmt PATCH "projects/$ref/config/auth" \
            --data "{\"uri_allow_list\":\"$next\"}" --target mbs/PayCraft >/dev/null 2>&1; then
        echo "  ✓ added to uri_allow_list: ${missing[*]}"
        return 0
    fi

    # Reaching here is PROOF that staging sign-in is broken — entries are missing AND the write
    # failed. Failing the phase is right: the point of staging is clicking through the app, and the
    # front door is sign-in. A green deploy the operator cannot log into wastes more time than a
    # stopped one. (`--keep-going` deploys anyway if you only need the marketing pages.)
    echo "  ✗ uri_allow_list PATCH failed — staging sign-in WILL bounce to production."
    echo "    Add manually: Supabase → Auth → URL Configuration → Redirect URLs:"
    for m in "${missing[@]}"; do echo "      $m"; done
    echo "    Or deploy anyway without sign-in: re-run with --keep-going"
    return 1
}

phase_s6_smoke_staging() {
    echo "  Target: $STAGING_URL"
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would curl $STAGING_URL/ + /api/health"; return 0
    fi
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$STAGING_URL/" 2>&1) || true
    [[ "$code" = "200" ]] && echo "  ✓ Root URL → HTTP 200" || { echo "  ✗ Root URL → HTTP $code"; return 1; }
    # The marker --promote-to-prod reads. Written ONLY after a passing smoke, so "it deployed" and
    # "it worked" cannot be confused with each other.
    printf '{"ts":"%s","env":"staging","status":"success","url":"%s","sha":"%s","db":"%s"}\n' \
        "$(date -u +%FT%TZ)" "$STAGING_URL" "$(git -C "$PAYCRAFT_SRC" rev-parse HEAD 2>/dev/null)" \
        "$([[ "$STAGING_DB_READY" = "true" ]] && echo "$STAGING_SUPABASE_REF" || echo "none-prod-backed")" \
        > "$STATE_DIR/last-staging.json"
    return 0
}

# --promote-to-prod: refuse unless staging was deployed AND its smoke passed.
assert_staged() {
    local f="$STATE_DIR/last-staging.json"
    if [[ ! -s "$f" ]]; then
        echo "  ✗ nothing has been staged — run: bash infra/deploy/deploy.sh --staging --apply" >&2
        return 1
    fi
    local staged_sha head_sha
    staged_sha="$(yq -r '.sha // ""' "$f" 2>/dev/null || true)"
    head_sha="$(git -C "$PAYCRAFT_SRC" rev-parse HEAD 2>/dev/null)"
    echo "  staged: ${staged_sha:0:8}   HEAD: ${head_sha:0:8}"
    if [[ -n "$staged_sha" && "$staged_sha" != "$head_sha" ]]; then
        # Promoting a different commit than the one that was rehearsed is the failure this whole
        # two-step exists to prevent.
        echo "  ✗ HEAD has moved since staging — re-stage before promoting." >&2
        return 1
    fi
    local staged_db; staged_db="$(yq -r '.db // "?"' "$f" 2>/dev/null || echo "?")"
    if [[ "$staged_db" = "none-prod-backed" ]]; then
        echo "  ⚠ that staging run had NO staging database — migrations were never rehearsed."
        echo "    Phase 3 will apply them to production for the first time. Watch it."
    fi
    echo "  ✓ staging verified for this commit"
    return 0
}

if [[ "$MODE" = "staging" ]]; then
    banner "PayCraft Deploy — env=staging, mode=$([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)"
    echo "  Deploying: $(git -C "$PAYCRAFT_SRC" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$PAYCRAFT_SRC" rev-parse --short HEAD 2>/dev/null)"

    run_phase 1   "PRE-FLIGHT"        "phase_1_preflight"                 || exit 1
    run_phase 2   "STAGING TARGET"    "phase_s1_resolve"                  || exit 1
    run_phase 2.5 "AUTH ALLOWLIST"    "phase_s2_5_auth_allowlist"         || exit 1
    if [[ "$STAGING_DB_READY" = "true" ]]; then
        run_phase 3   "MIGRATIONS"       "phase_3_migrations"             || exit 1
        run_phase 3.5 "FUNCTIONS DEPLOY" "phase_3_5_functions"            || exit 1
    else
        phase_end 3   "MIGRATIONS"       "SKIP" "0" "no staging database"
        phase_end 3.5 "FUNCTIONS DEPLOY" "SKIP" "0" "no staging database"
    fi
    run_phase 5   "DEPLOY CLOUDFLARE" "phase_5_deploy_cloudflare"        || exit 1
    run_phase 6   "SMOKE"             "phase_s6_smoke_staging"            || exit 1

    banner "PayCraft Staging — done in $(($(date -u +%s) - START_TS))s"
    echo "  Staging: $STAGING_URL"
    echo "  Promote: bash infra/deploy/deploy.sh --promote-to-prod --apply --confirm-production"
    printf '{"ts":"%s","env":"staging","status":"success","duration_s":%d,"apply":%s}\n' \
        "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" "$APPLY" >> "$LEDGER"
    exit 0
fi

if [[ "$MODE" = "local" ]]; then
    banner "PayCraft Local — $LOCAL_URL"
    run_phase 1 "LOCAL PRE-FLIGHT"    "phase_local_1_preflight"      || exit 1
    run_phase 2 "SUPABASE RESTART"    "phase_local_2_supabase_restart" || exit 1
    run_phase 3 "DEV SERVER START"    "phase_local_3_dev_server"     || exit 1
    run_phase 4 "READY WAIT"          "phase_local_4_ready_wait"     || exit 1
    run_phase 5 "LOCAL SMOKE"         "phase_local_5_smoke"          || true   # smoke is informational

    banner "PayCraft Local — ready in $(($(date -u +%s) - START_TS))s"
    cat <<EOF
  ✅ Dashboard:  $LOCAL_URL
  ✅ Login:      $LOCAL_URL/auth/login
  ✅ Supabase:   $LOCAL_SB_API
  ✅ Studio:     $LOCAL_SB_STUDIO

  Dev server PID: $(cat "$DEV_PID_FILE" 2>/dev/null)
  Logs:           tail -f $DEV_LOG
  Stop:           kill \$(cat $DEV_PID_FILE)  +  supabase stop
EOF
    printf '{"ts":"%s","env":"local","status":"success","duration_s":%d,"dev_pid":%s}\n' \
        "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" \
        "$(cat $DEV_PID_FILE 2>/dev/null || echo 0)" >> "$LEDGER"
    exit 0
fi

# MODE = prod
banner "PayCraft Deploy — env=production, mode=$([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)"

# --promote-to-prod only: production takes the commit staging already proved, or nothing.
if [[ "$REQUIRE_STAGED" = "true" ]]; then
    run_phase 0 "STAGED CHECK" "assert_staged" || exit 1
fi

run_phase 1   "PRE-FLIGHT"       "phase_1_preflight"     || exit 1
run_phase 2   "SECRETS SYNC"     "phase_2_secrets_sync"  || exit 1
run_phase 3   "MIGRATIONS"       "phase_3_migrations"    || exit 1
run_phase 3.5 "FUNCTIONS DEPLOY" "phase_3_5_functions"   || exit 1
run_phase 4   "PROMOTE"          "phase_4_promote"       || exit 1
run_phase 5   "DEPLOY CLOUDFLARE" "phase_5_deploy_cloudflare" || exit 1
run_phase 6   "SMOKE"            "phase_6_smoke"         || exit 1

banner "PayCraft Deploy — done in $(($(date -u +%s) - START_TS))s"
echo "  Live: $PROD_URL"

printf '{"ts":"%s","env":"production","status":"success","duration_s":%d,"apply":%s,"main_sha":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" "$APPLY" \
    "$(git -C $PAYCRAFT_SRC rev-parse --short origin/main 2>/dev/null)" >> "$LEDGER"

# cloudflare-deploy wired via /paycraft-deploy phase 5 (2026-08-23)
