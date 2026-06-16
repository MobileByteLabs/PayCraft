#!/usr/bin/env bash
#
# deploy.sh — PayCraft v2.0 production deploy orchestrator.
#
# Drives all 8 phases per infra/deploy/PAYCRAFT_DEPLOY.md.
# Dry-run by default; --apply for mutations; --confirm-production required for prod.
#
# Loaded by: framework skill /paycraft-deploy (.claude/skills/paycraft-deploy/SKILL.md)
#
set -eo pipefail

# ═══════════════════════════════════════════════════════════
# Resolve paths
# ═══════════════════════════════════════════════════════════
PAYCRAFT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FW_ROOT="$(cd "$PAYCRAFT_SRC/../../../../../.." && pwd)"
STATE_DIR="$PAYCRAFT_SRC/infra/deploy/.state"
LEDGER="$PAYCRAFT_SRC/infra/deploy/.deploy-ledger.jsonl"
mkdir -p "$STATE_DIR"

# ═══════════════════════════════════════════════════════════
# Parse args
# ═══════════════════════════════════════════════════════════
APPLY=false
CONFIRM_PROD=false
ENV_TARGET="production"
FROM_PHASE=0
TO_PHASE=8
ONLY_PHASE=""
SKIP_DNS=false
SKIP_BUILD=false
SKIP_BOOTSTRAP=false
KEEP_GOING=false
VERBOSE=false
SILENT=false
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)                  APPLY=true; shift ;;
        --dry-run)                APPLY=false; shift ;;
        --confirm-production)     CONFIRM_PROD=true; shift ;;
        --env)                    ENV_TARGET="$2"; shift 2 ;;
        --from-phase)             FROM_PHASE="$2"; shift 2 ;;
        --to-phase)               TO_PHASE="$2"; shift 2 ;;
        --only-phase)             ONLY_PHASE="$2"; FROM_PHASE="$2"; TO_PHASE="$2"; shift 2 ;;
        --skip-dns)               SKIP_DNS=true; shift ;;
        --skip-build)             SKIP_BUILD=true; shift ;;
        --skip-bootstrap)         SKIP_BOOTSTRAP=true; shift ;;
        --keep-going)             KEEP_GOING=true; shift ;;
        --verbose)                VERBOSE=true; shift ;;
        --silent)                 SILENT=true; shift ;;
        --non-interactive)        NON_INTERACTIVE=true; shift ;;
        -h|--help)
            sed -n '/^# CLI/,/^$/p' "$PAYCRAFT_SRC/infra/deploy/PAYCRAFT_DEPLOY.md" 2>/dev/null \
                || echo "See infra/deploy/PAYCRAFT_DEPLOY.md for usage."
            exit 0
            ;;
        *) echo "Unknown flag: $1 — see --help" >&2; exit 1 ;;
    esac
done

# Safety: production + --apply requires --confirm-production
if [[ "$APPLY" = "true" && "$ENV_TARGET" = "production" && "$CONFIRM_PROD" != "true" ]]; then
    echo "ERROR: --apply with --env=production requires --confirm-production flag (safety)" >&2
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# Output helpers
# ═══════════════════════════════════════════════════════════
PHASE_RESULTS=()
START_TS=$(date -u +%s)

banner() {
    [[ "$SILENT" = "true" ]] && return
    echo "═══════════════════════════════════════════════════════════════"
    printf "  %s\n" "$1"
    echo "═══════════════════════════════════════════════════════════════"
}

phase_start() {
    local n="$1" name="$2"
    [[ "$SILENT" = "true" ]] && return
    echo ""
    echo "▶ Phase $n: $name"
    echo "──────────────────────────────────────────────────────"
}

phase_end() {
    local n="$1" name="$2" status="$3" duration="$4" details="${5:-}"
    PHASE_RESULTS+=("$n|$name|$status|$duration|$details")
    [[ "$SILENT" = "true" ]] && return

    local icon
    case "$status" in
        PASS)  icon="✓" ;;
        FAIL)  icon="✗" ;;
        SKIP)  icon="↷" ;;
        *)     icon="?" ;;
    esac
    printf "[%d] %-20s %s %s  %ss  %s\n" "$n" "$name" "$icon" "$status" "$duration" "$details"
}

run_phase() {
    local n="$1" name="$2" body="$3"
    if [[ -n "$ONLY_PHASE" && "$n" != "$ONLY_PHASE" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "not in --only-phase"
        return 0
    fi
    if [[ "$n" -lt "$FROM_PHASE" ]] || [[ "$n" -gt "$TO_PHASE" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "out of range"
        return 0
    fi
    if [[ "$SKIP_DNS" = "true" && ( "$n" = "6" || "$n" = "7" ) ]]; then
        phase_end "$n" "$name" "SKIP" "0" "--skip-dns"
        return 0
    fi
    if [[ "$SKIP_BUILD" = "true" && "$n" = "4" ]]; then
        phase_end "$n" "$name" "SKIP" "0" "--skip-build"
        return 0
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
            failure_banner "$n" "$name" "$rc"
            return 1
        fi
        return 0
    fi
}

# ═══════════════════════════════════════════════════════════
# Phase implementations
# ═══════════════════════════════════════════════════════════
phase_0_bootstrap() {
    local args=()
    if [[ "$APPLY" != "true" ]]; then
        args+=("--check-only")
    fi
    if [[ "$NON_INTERACTIVE" = "true" ]]; then
        args+=("--non-interactive")
    fi
    bash "$PAYCRAFT_SRC/infra/deploy/bootstrap.sh" "${args[@]}"
}

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
    bash "$PAYCRAFT_SRC/infra/sync-to-vercel.sh" $flag --env "$ENV_TARGET" \
        && bash "$PAYCRAFT_SRC/infra/sync-to-supabase.sh" $flag
}

phase_3_migrations() {
    cd "$PAYCRAFT_SRC"
    if [[ "$APPLY" = "true" ]]; then
        echo "  Running: supabase db push --linked"
        supabase db push --linked --include-roles
    else
        echo "  [DRY] supabase migration list --linked"
        supabase migration list --linked 2>&1 | tail -10 || true
    fi
}

phase_4_build() {
    cd "$PAYCRAFT_SRC/dashboard"
    if [[ "$APPLY" = "true" ]]; then
        echo "  Running: npm ci && npm run build"
        npm ci --no-audit --no-fund 2>&1 | tail -3
        npm run build 2>&1 | tail -10
    else
        echo "  [DRY] cd dashboard && npm ci && npm run build"
        [[ -d node_modules ]] && echo "  (node_modules exists; would use npm ci)"
        echo "  (build output goes to dashboard/.next/)"
    fi
}

phase_5_deploy() {
    cd "$PAYCRAFT_SRC/dashboard"
    if [[ "$APPLY" = "true" ]]; then
        local tmpkey
        tmpkey=$(mktemp)
        chmod 600 "$tmpkey"
        bash "$FW_ROOT/core/scripts/secrets-get.sh" --alias mbs-paycraft-vercel-token --to-file "$tmpkey"
        local token
        token=$(cat "$tmpkey")
        shred -u "$tmpkey" 2>/dev/null || rm -f "$tmpkey"

        echo "  Running: vercel --prod (token redacted)"
        local prod_flag=""
        [[ "$ENV_TARGET" = "production" ]] && prod_flag="--prod"
        local deploy_url
        deploy_url=$(vercel deploy $prod_flag --token "$token" --yes 2>&1 | tail -1)
        echo "  Deploy URL: $deploy_url"
        echo "$deploy_url" > "$STATE_DIR/last-deploy-url"
        unset token
    else
        echo "  [DRY] vercel deploy --prod --token <vault:mbs-paycraft-vercel-token>"
    fi
}

phase_6_dns() {
    local hostname="paycraft.mobilebytesensei.com"
    local expected_cname="cname.vercel-dns.com"

    echo "  Target: $hostname → $expected_cname"

    # Try Wix MCP first if available
    if command -v claude >/dev/null 2>&1 && claude mcp list 2>/dev/null | grep -q "^wix"; then
        echo "  Wix MCP detected — attempting auto-configure (requires session with MCP loaded)"
        echo "  ⚠ Note: MCP tools are only available in Claude sessions; this shell run can't call MCPs."
        echo "  Falling back to manual verification."
    fi

    # Manual fallback: dig + prompt
    local current
    current=$(dig +short "$hostname" CNAME 2>/dev/null | head -1 | sed 's/\.$//')
    if [[ "$current" = "$expected_cname" ]]; then
        echo "  ✓ CNAME already configured correctly"
        return 0
    fi

    echo ""
    echo "  ⚠ CNAME not yet configured. Add it in Wix Dashboard:"
    echo ""
    echo "    1. Open https://manage.wix.com/account/sites"
    echo "    2. Pick mobilebytesensei.com → Domains → Manage DNS Records"
    echo "    3. Add CNAME record:"
    echo "         Host:  paycraft"
    echo "         Value: cname.vercel-dns.com"
    echo "         TTL:   1 Hour"
    echo "    4. Click Save"
    echo ""
    if [[ "$APPLY" = "true" ]]; then
        echo -n "  Have you added the CNAME and is it propagating? [y/N] "
        read -r reply
        if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
            return 1
        fi
        # Wait for propagation up to 60s
        local elapsed=0
        while [[ $elapsed -lt 60 ]]; do
            current=$(dig +short "$hostname" CNAME 2>/dev/null | head -1 | sed 's/\.$//')
            if [[ "$current" = "$expected_cname" ]]; then
                echo "  ✓ CNAME resolved after ${elapsed}s"
                return 0
            fi
            sleep 5
            elapsed=$((elapsed + 5))
        done
        echo "  ✗ CNAME did not propagate within 60s. Re-run --from-phase 6 later."
        return 1
    else
        echo "  [DRY] Would wait for user confirmation + verify resolution."
        return 0
    fi
}

phase_7_domain_attach() {
    local hostname="paycraft.mobilebytesensei.com"
    cd "$PAYCRAFT_SRC/dashboard"

    if [[ "$APPLY" = "true" ]]; then
        local tmpkey
        tmpkey=$(mktemp)
        chmod 600 "$tmpkey"
        bash "$FW_ROOT/core/scripts/secrets-get.sh" --alias mbs-paycraft-vercel-token --to-file "$tmpkey"
        local token
        token=$(cat "$tmpkey")
        shred -u "$tmpkey" 2>/dev/null || rm -f "$tmpkey"

        echo "  Attaching $hostname to Vercel project..."
        vercel domains add "$hostname" --token "$token" 2>&1 | tail -3 || true

        # Poll for SSL cert valid
        echo "  Waiting for SSL cert provision (up to 90s)..."
        local elapsed=0
        while [[ $elapsed -lt 90 ]]; do
            if curl -fsS --max-time 5 "https://$hostname" -o /dev/null 2>/dev/null; then
                echo "  ✓ SSL cert valid after ${elapsed}s"
                unset token
                return 0
            fi
            sleep 5
            elapsed=$((elapsed + 5))
        done
        echo "  ⚠ SSL not ready after 90s; will retry in phase 8"
        unset token
    else
        echo "  [DRY] vercel domains add $hostname --token <vault:...>"
    fi
}

phase_8_health() {
    local hostname="paycraft.mobilebytesensei.com"
    if [[ "$APPLY" = "true" ]]; then
        bash "$PAYCRAFT_SRC/infra/deploy/health-check.sh" "https://$hostname"
    else
        echo "  [DRY] bash infra/deploy/health-check.sh https://$hostname"
        echo "        (curl /api/health + Playwright /auth/login smoke)"
    fi
}

# ═══════════════════════════════════════════════════════════
# Failure banner
# ═══════════════════════════════════════════════════════════
failure_banner() {
    local n="$1" name="$2" rc="$3"
    local total=$(($(date -u +%s) - START_TS))
    echo ""
    banner "PayCraft Deploy — ABORTED at phase $n ($name)"
    echo "  Phase failed with exit code: $rc"
    echo "  Total time so far:           ${total}s"
    echo "  Env:                         $ENV_TARGET"
    echo ""
    echo "  Phases completed:"
    for result in "${PHASE_RESULTS[@]}"; do
        IFS='|' read -r pn pname pstatus pdur pdet <<< "$result"
        [[ "$pstatus" = "PASS" ]] && printf "    [%d] %-20s ✓ %s  %ss\n" "$pn" "$pname" "$pstatus" "$pdur"
    done
    echo ""
    echo "  Resume after fix:"
    echo "    bash infra/deploy/deploy.sh --apply --confirm-production --from-phase $n"
    echo "═══════════════════════════════════════════════════════════════"
    log_ledger "aborted" "$n"
    exit "$rc"
}

# ═══════════════════════════════════════════════════════════
# Ledger
# ═══════════════════════════════════════════════════════════
log_ledger() {
    local status="$1" failed_phase="${2:-}"
    local total=$(($(date -u +%s) - START_TS))
    local ts
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local deploy_id
    deploy_id=$(cat "$STATE_DIR/last-deploy-url" 2>/dev/null | grep -oE 'dpl_[A-Za-z0-9]+' | head -1 || echo "")
    cat <<JSON >> "$LEDGER"
{"ts":"$ts","env":"$ENV_TARGET","status":"$status","duration_s":$total,"failed_phase":"$failed_phase","deploy_id":"$deploy_id","apply":$APPLY}
JSON
}

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════
banner "PayCraft Deploy — env=$ENV_TARGET, mode=$([[ $APPLY = true ]] && echo APPLY || echo DRY-RUN)"

if [[ "$SKIP_BOOTSTRAP" != "true" ]]; then
    run_phase 0 "BOOTSTRAP"   "phase_0_bootstrap"
fi
run_phase 1 "PRE-FLIGHT"      "phase_1_preflight"
run_phase 2 "SECRETS SYNC"    "phase_2_secrets_sync"
run_phase 3 "MIGRATIONS"      "phase_3_migrations"
run_phase 4 "BUILD"           "phase_4_build"
run_phase 5 "DEPLOY"          "phase_5_deploy"
run_phase 6 "DNS"             "phase_6_dns"
run_phase 7 "DOMAIN ATTACH"   "phase_7_domain_attach"
run_phase 8 "HEALTH"          "phase_8_health"

# ═══════════════════════════════════════════════════════════
# Final summary banner
# ═══════════════════════════════════════════════════════════
total=$(($(date -u +%s) - START_TS))
echo ""
banner "PayCraft Deploy Complete — env=$ENV_TARGET"
echo "  Total time:  ${total}s"
echo ""
echo "  Phase summary:"
for result in "${PHASE_RESULTS[@]}"; do
    IFS='|' read -r pn pname pstatus pdur pdet <<< "$result"
    local icon
    case "$pstatus" in
        PASS) icon="✓" ;;
        FAIL) icon="✗" ;;
        SKIP) icon="↷" ;;
        *)    icon="?" ;;
    esac
    printf "    [%d] %-20s %s %s  %ss  %s\n" "$pn" "$pname" "$icon" "$pstatus" "$pdur" "$pdet"
done
echo ""
last_url=$(cat "$STATE_DIR/last-deploy-url" 2>/dev/null || echo "")
[[ -n "$last_url" ]] && echo "  Vercel URL:   $last_url"
[[ "$ENV_TARGET" = "production" ]] && echo "  Live URL:     https://paycraft.mobilebytesensei.com"
echo "  Ledger:       infra/deploy/.deploy-ledger.jsonl"
echo "═══════════════════════════════════════════════════════════════"
log_ledger "success"
