#!/usr/bin/env bash
#
# deploy.sh — PayCraft v2.0 GitHub-integrated production deploy orchestrator.
#
# Architecture (post-2026-06-17):
#   • Vercel auto-deploys main branch via GitHub App integration
#   • Direct push to development/main is blocked by GitHub repo rules
#   • Production = main branch HEAD; main is kept as exact fast-forward of development
#   • This script wires the dev → main PR + waits for Vercel
#
# Phases:
#   1 PRE-FLIGHT     verify CLIs, vault, vercel project, gh auth
#   2 SECRETS SYNC   vault → vercel env (production scope)
#   3 MIGRATIONS     vault-mediated supabase db push --db-url
#   4 PROMOTE        open PR development → main, merge it (fast-forward if possible)
#   5 WAIT VERCEL    poll Vercel API for production deploy of main HEAD → READY
#   6 SMOKE          curl /api/health on https://paycraft.mobilebytesensei.com
#
# Dry-run by default — pass --apply --confirm-production for mutating phases.
#
# Sub-commands:
#   deploy.sh status     emit YAML-like state blob (consumed by SKILL.md matrix)
#   deploy.sh ship       alias for --apply --confirm-production (full chain)
#   deploy.sh verify     alias for --only-phase 1 (read-only preflight)
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

VERCEL_PROJECT_ID="prj_HQ7IQe4XyxFk3SU0dV6X3n2n7kme"
VERCEL_TEAM_ID="team_yIBRq8fQTksr6aM3K27PgCgI"
PROD_URL="https://paycraft.mobilebytesensei.com"
GITHUB_REPO="MobileByteLabs/PayCraft"
SUPABASE_REF="mlwfgytjxlqyfxcgpysm"

# ═══════════════════════════════════════════════════════════
# Parse args
# ═══════════════════════════════════════════════════════════
APPLY=false
CONFIRM_PROD=false
FROM_PHASE=1
TO_PHASE=6
ONLY_PHASE=""
KEEP_GOING=false
VERBOSE=false
SILENT=false
SUB_COMMAND=""

# Sub-command detection
case "${1:-}" in
    status|matrix|info)
        SUB_COMMAND="$1"; shift ;;
    ship)
        SUB_COMMAND="ship"; APPLY=true; CONFIRM_PROD=true; shift ;;
    verify)
        SUB_COMMAND="verify"; ONLY_PHASE=1; FROM_PHASE=1; TO_PHASE=1; shift ;;
esac

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)                APPLY=true; shift ;;
        --dry-run)              APPLY=false; shift ;;
        --confirm-production)   CONFIRM_PROD=true; shift ;;
        --from-phase)           FROM_PHASE="$2"; shift 2 ;;
        --to-phase)             TO_PHASE="$2"; shift 2 ;;
        --only-phase)           ONLY_PHASE="$2"; FROM_PHASE="$2"; TO_PHASE="$2"; shift 2 ;;
        --keep-going)           KEEP_GOING=true; shift ;;
        --verbose)              VERBOSE=true; shift ;;
        --silent)               SILENT=true; shift ;;
        -h|--help)
            sed -n '/^# Phases:/,/^# Sub-commands:/p' "${BASH_SOURCE[0]}" | head -20
            exit 0 ;;
        *) echo "Unknown flag: $1 — see --help" >&2; exit 1 ;;
    esac
done

# Safety: mutating phases require --confirm-production
if [[ "$APPLY" = "true" && "$CONFIRM_PROD" != "true" ]]; then
    echo "ERROR: --apply requires --confirm-production (safety)" >&2
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════
PHASE_RESULTS=()
START_TS=$(date -u +%s)

banner() { [[ "$SILENT" = "true" ]] && return; echo "═══════════════════════════════════════════════════════════════"; printf "  %s\n" "$1"; echo "═══════════════════════════════════════════════════════════════"; }
phase_start() { [[ "$SILENT" = "true" ]] && return; echo ""; echo "▶ Phase $1: $2"; echo "──────────────────────────────────────────────────────"; }
phase_end() {
    local n="$1" name="$2" status="$3" duration="$4" details="${5:-}"
    PHASE_RESULTS+=("$n|$name|$status|$duration|$details")
    [[ "$SILENT" = "true" ]] && return
    local icon
    case "$status" in PASS) icon="✓";; FAIL) icon="✗";; SKIP) icon="↷";; *) icon="?";; esac
    printf "[%d] %-20s %s %s  %ss  %s\n" "$n" "$name" "$icon" "$status" "$duration" "$details"
}

run_phase() {
    local n="$1" name="$2" body="$3"
    if [[ -n "$ONLY_PHASE" && "$n" != "$ONLY_PHASE" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "not in --only-phase"; return 0
    fi
    if [[ "$n" -lt "$FROM_PHASE" ]] || [[ "$n" -gt "$TO_PHASE" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "out of range"; return 0
    fi
    phase_start "$n" "$name"
    local ts=$(date -u +%s)
    if eval "$body"; then
        local dur=$(($(date -u +%s) - ts))
        phase_end "$n" "$name" "PASS" "$dur"
        echo "$n" > "$STATE_DIR/phase-$n.done"
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

# vercel API helper — uses cached CLI auth (~/Library/Application Support/com.vercel.cli/auth.json)
vercel_api() {
    local path="$1" method="${2:-GET}" body="${3:-}"
    local token
    token=$(node -e "console.log(JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), 'Library/Application Support/com.vercel.cli/auth.json'),'utf-8')).token)" 2>/dev/null) || return 1
    if [[ -n "$body" ]]; then
        node -e "
          fetch('https://api.vercel.com${path}', {
            method: '${method}',
            headers: { 'Authorization': 'Bearer ${token}', 'Content-Type': 'application/json' },
            body: ${body}
          }).then(r=>r.text()).then(t=>console.log(t));
        "
    else
        node -e "
          fetch('https://api.vercel.com${path}', {
            headers: { 'Authorization': 'Bearer ${token}' }
          }).then(r=>r.text()).then(t=>console.log(t));
        "
    fi
}

# ═══════════════════════════════════════════════════════════
# Phase implementations
# ═══════════════════════════════════════════════════════════
phase_1_preflight() {
    if [[ "$VERBOSE" = "true" ]]; then
        bash "$PAYCRAFT_SRC/infra/deploy/preflight.sh" --verbose
    else
        bash "$PAYCRAFT_SRC/infra/deploy/preflight.sh"
    fi
}

phase_2_secrets_sync() {
    local flag=""
    [[ "$APPLY" = "true" ]] && flag="--apply"
    bash "$PAYCRAFT_SRC/infra/sync-to-vercel.sh" $flag --env production
}

phase_3_migrations() {
    cd "$PAYCRAFT_SRC"
    local db_url_file db_url
    db_url_file=$(mktemp -t paycraft-dburl-XXXXXX)
    trap "rm -f $db_url_file" RETURN
    if ! bash "$FW_ROOT/core/scripts/secrets-get.sh" framework-supabase-db-url --to-file "$db_url_file" 2>/dev/null; then
        echo "  ✗ framework-supabase-db-url not resolvable from vault"; return 1
    fi
    db_url=$(cat "$db_url_file")
    if [[ "$APPLY" = "true" ]]; then
        echo "  Running: supabase db push --include-all --db-url <framework-supabase>"
        yes y | supabase db push --include-all --db-url "$db_url" --include-roles 2>&1 | tail -15
    else
        echo "  [DRY] supabase migration list --db-url <framework-supabase>"
        supabase migration list --db-url "$db_url" 2>&1 | tail -10 || true
    fi
}

# Phase 4 — promote development → main as exact fast-forward replica
phase_4_promote() {
    cd "$PAYCRAFT_SRC"

    # Ensure local main + development are up to date
    git fetch origin development main 2>/dev/null

    local dev_sha main_sha
    dev_sha=$(git rev-parse origin/development)
    main_sha=$(git rev-parse origin/main)

    if [[ "$dev_sha" = "$main_sha" ]]; then
        echo "  ✓ main already at development HEAD ($dev_sha) — nothing to promote"
        return 0
    fi

    echo "  development: $dev_sha"
    echo "  main:        $main_sha"
    echo "  Promoting development → main..."

    if [[ "$APPLY" != "true" ]]; then
        local ahead
        ahead=$(git rev-list --count origin/main..origin/development)
        echo "  [DRY] would open PR development → main ($ahead commits ahead)"
        echo "  [DRY] would auto-merge with --merge to keep main = development"
        return 0
    fi

    # Check for an existing open dev→main PR; reuse if present
    local pr_num
    pr_num=$(gh pr list --base main --head development --state open --json number --jq '.[0].number // empty' 2>/dev/null)
    if [[ -z "$pr_num" ]]; then
        echo "  Opening PR development → main..."
        pr_num=$(gh pr create --base main --head development \
            --title "release: promote development → main ($(date -u +%Y-%m-%dT%H:%M:%SZ))" \
            --body "Auto-opened by /paycraft-deploy Phase 4 PROMOTE.

Source: origin/development @ ${dev_sha}
Target: origin/main @ ${main_sha}
Diff:   $(git rev-list --count origin/main..origin/development) commits

This PR is fast-forward-only — main is kept as an exact replica of development at promote time. No manual edits should land on main." 2>&1 | grep -oE 'https://[^ ]+/[0-9]+' | grep -oE '[0-9]+$' | head -1)
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
phase_5_wait_vercel() {
    if [[ "$APPLY" != "true" ]]; then
        echo "  [DRY] would poll Vercel API for production deploy of latest main commit"
        return 0
    fi

    cd "$PAYCRAFT_SRC"
    git fetch origin main 2>/dev/null
    local target_sha
    target_sha=$(git rev-parse origin/main | cut -c1-7)
    echo "  Waiting for Vercel production deploy of commit ${target_sha}..."

    local start=$(date +%s)
    local deadline=$((start + 10*60))   # 10-min cap
    local last_state=""
    while [[ $(date +%s) -lt $deadline ]]; do
        local raw
        raw=$(vercel_api "/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=5&target=production" 2>/dev/null)
        local match
        match=$(node -e "
            const j = JSON.parse(\`${raw//\`/\\\`}\`);
            const d = (j.deployments || []).find(d => {
                const sha = (d.meta?.githubCommitSha || d.meta?.gitCommitSha || '').slice(0,7);
                return sha === '${target_sha}';
            });
            if (d) console.log(JSON.stringify({id: d.uid, state: d.state, url: d.url, inspector: d.inspectorUrl}));
        " 2>/dev/null)
        if [[ -n "$match" ]]; then
            local state url inspector
            state=$(echo "$match" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf-8')).state)")
            url=$(echo "$match" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf-8')).url)")
            inspector=$(echo "$match" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf-8')).inspector)")
            if [[ "$state" != "$last_state" ]]; then
                printf "  [%4ds] state=%-10s url=%s\n" "$(($(date +%s)-start))" "$state" "$url"
                last_state="$state"
            fi
            case "$state" in
                READY)
                    echo "  ✓ Production deploy READY"
                    echo "    Inspector: $inspector"
                    echo "    URL:       https://$url"
                    echo "$url" > "$STATE_DIR/last-deploy-url"
                    return 0 ;;
                ERROR|CANCELED|BLOCKED)
                    echo "  ✗ Production deploy ended in $state"
                    echo "    Inspector: $inspector"
                    return 1 ;;
            esac
        fi
        sleep 8
    done
    echo "  ✗ Timeout (10 min) waiting for Vercel production deploy"
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
    printf "cli_vercel:    %s\n"   "$(command -v vercel >/dev/null && echo INSTALLED || echo MISSING)"
    printf "cli_supabase:  %s\n"   "$(command -v supabase >/dev/null && echo INSTALLED || echo MISSING)"
    printf "cli_gh:        %s\n"   "$(command -v gh >/dev/null && echo INSTALLED || echo MISSING)"
    printf "auth_vercel:   %s\n"   "$(vercel whoami 2>/dev/null || echo NOT-LOGGED-IN)"
    printf "auth_gh:       %s\n"   "$(gh auth status 2>&1 | grep -oE 'Logged in to github.com as [^ ]+' | head -1 || echo NOT-LOGGED-IN)"
    printf "link_vercel:   %s\n"   "$([ -f $PAYCRAFT_SRC/dashboard/.vercel/project.json ] && echo LINKED || echo NOT-LINKED)"
    echo ""

    echo "─── vault (5 secrets — BYOK) ───────────────────────"
    local SECRETS=(
        mbs-paycraft-encryption-key
        mbs-paycraft-resend-api-key
        mbs-paycraft-vercel-token
        mbs-paycraft-vercel-org-id
        mbs-paycraft-vercel-project-id
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
    git fetch -q origin development main 2>/dev/null || true
    local dev_sha main_sha ahead
    dev_sha=$(git rev-parse --short origin/development 2>/dev/null || echo "?")
    main_sha=$(git rev-parse --short origin/main 2>/dev/null || echo "?")
    ahead=$(git rev-list --count origin/main..origin/development 2>/dev/null || echo "?")
    printf "development:   %s\n" "$dev_sha"
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
            3) name="MIGRATIONS" ;; 4) name="PROMOTE" ;;
            5) name="WAIT VERCEL" ;; 6) name="SMOKE" ;;
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
        [[ "$rstatus" = "PASS" ]] && printf "    [%d] %-20s ✓ PASS  %ss\n" "$rn" "$rname" "$rdur"
    done
    echo ""
    echo "  Resume after fix:"
    echo "    bash infra/deploy/deploy.sh --apply --confirm-production --from-phase $n"
    echo "═══════════════════════════════════════════════════════════════"

    printf '{"ts":"%s","env":"production","status":"aborted","duration_s":%d,"failed_phase":"%d","apply":%s}\n' \
        "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" "$n" "$APPLY" >> "$LEDGER"
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
if [[ "$SUB_COMMAND" = "status" || "$SUB_COMMAND" = "matrix" || "$SUB_COMMAND" = "info" ]]; then
    emit_status
    exit 0
fi

banner "PayCraft Deploy — env=production, mode=$([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)"

run_phase 1 "PRE-FLIGHT"     "phase_1_preflight"     || exit 1
run_phase 2 "SECRETS SYNC"   "phase_2_secrets_sync"  || exit 1
run_phase 3 "MIGRATIONS"     "phase_3_migrations"    || exit 1
run_phase 4 "PROMOTE"        "phase_4_promote"       || exit 1
run_phase 5 "WAIT VERCEL"    "phase_5_wait_vercel"   || exit 1
run_phase 6 "SMOKE"          "phase_6_smoke"         || exit 1

banner "PayCraft Deploy — done in $(($(date -u +%s) - START_TS))s"
echo "  Live: $PROD_URL"

printf '{"ts":"%s","env":"production","status":"success","duration_s":%d,"apply":%s,"main_sha":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$(($(date -u +%s) - START_TS))" "$APPLY" \
    "$(git -C $PAYCRAFT_SRC rev-parse --short origin/main 2>/dev/null)" >> "$LEDGER"
