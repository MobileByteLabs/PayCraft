#!/usr/bin/env bash
#
# preflight.sh — Phase 1 of /paycraft-deploy.
#
# Verifies the deploy can proceed. Hard-fails if ANY check fails.
# Returns exit 0 if all green, 1 if any hard-required check failed.
#
# Usage: preflight.sh [--verbose]
#
set -eo pipefail

VERBOSE=false
[[ "${1:-}" = "--verbose" ]] && VERBOSE=true

FW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../../.." && pwd)"
PAYCRAFT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0
FAIL=0
declare -a FAILURES

check() {
    local name="$1"
    local cmd="$2"
    local hard="${3:-true}"

    if eval "$cmd" >/dev/null 2>&1; then
        printf "  ✓ %s\n" "$name"
        PASS=$((PASS + 1))
    else
        if [[ "$hard" = "true" ]]; then
            printf "  ✗ %s  (HARD FAIL)\n" "$name"
            FAILURES+=("$name")
            FAIL=$((FAIL + 1))
        else
            printf "  ⚠ %s  (warn only)\n" "$name"
        fi
        [[ "$VERBOSE" = "true" ]] && eval "$cmd" 2>&1 | sed 's/^/      /'
    fi
}

echo "─── Phase 1: PRE-FLIGHT ───────────────────────────────"

# 1. Active project
check "Active project = mbs/PayCraft" \
    "[ \"\$(bash ${FW_ROOT}/core/scripts/session-resolve.sh)\" = mbs/PayCraft ]"

# 2. Git clean (source repo)
check "Source repo git working tree clean" \
    "[ -z \"\$(git -C ${PAYCRAFT_SRC} status --porcelain)\" ]"

# 3. 14 PayCraft vault secrets — use secrets-verify if available, else per-alias check
if [[ -f "${FW_ROOT}/core/scripts/secrets-verify.sh" ]]; then
    check "14 PayCraft vault secrets present" \
        "bash ${FW_ROOT}/core/scripts/secrets-verify.sh --required-for mbs/PayCraft"
else
    SECRETS=(
        mbs-paycraft-stripe-platform-secret-key
        mbs-paycraft-stripe-platform-publishable-key
        mbs-paycraft-stripe-platform-webhook-secret
        mbs-paycraft-stripe-connect-client-id
        mbs-paycraft-razorpay-key-id
        mbs-paycraft-razorpay-key-secret
        mbs-paycraft-razorpay-webhook-secret
        mbs-paycraft-resend-api-key
        mbs-paycraft-sentry-dsn
        mbs-paycraft-sentry-auth-token
        mbs-paycraft-encryption-key
        mbs-paycraft-vercel-token
        mbs-paycraft-vercel-org-id
        mbs-paycraft-vercel-project-id
    )
    MISSING=()
    for a in "${SECRETS[@]}"; do
        bash "${FW_ROOT}/core/scripts/secrets-get.sh" --alias "$a" --exists-only 2>/dev/null || MISSING+=("$a")
    done
    if [[ ${#MISSING[@]} -eq 0 ]]; then
        printf "  ✓ 14 PayCraft vault secrets present\n"
        PASS=$((PASS + 1))
    else
        printf "  ✗ Missing vault secrets (%d):\n" "${#MISSING[@]}"
        for m in "${MISSING[@]}"; do printf "      - %s\n" "$m"; done
        printf "    Push via: infra/secrets-push-checklist.md\n"
        FAILURES+=("vault-secrets-missing-${#MISSING[@]}")
        FAIL=$((FAIL + 1))
    fi
fi

# 4-5. Vercel CLI
check "Vercel CLI installed" "command -v vercel"
check "Vercel CLI logged in" "vercel whoami"
check "Vercel project linked (dashboard)" "[ -f ${PAYCRAFT_SRC}/dashboard/.vercel/project.json ]"

# 6-7. Supabase CLI
check "Supabase CLI installed" "command -v supabase"
check "Supabase CLI logged in" "supabase projects list"
check "Supabase project linked" \
    "[ -f ${PAYCRAFT_SRC}/supabase/.temp/project-ref ] || grep -q project_id ${PAYCRAFT_SRC}/supabase/config.toml"

# 8. framework-supabase reachable
FW_SB_URL=$(bash "${FW_ROOT}/core/scripts/secrets-get.sh" --alias framework-supabase-url --stdout-allowed 2>/dev/null || echo "")
if [[ -n "$FW_SB_URL" ]]; then
    check "framework-supabase reachable" \
        "curl -fsS --max-time 10 ${FW_SB_URL}/rest/v1/ -H 'apikey: dummy' -o /dev/null"
else
    printf "  ⚠ Cannot test framework-supabase reachability (URL alias not resolvable)\n"
fi

# 9. Wix MCP (informational only)
if claude mcp list 2>/dev/null | grep -q "^wix"; then
    printf "  ✓ Wix MCP configured (will be used in phase 6 after session restart)\n"
    PASS=$((PASS + 1))
else
    printf "  ⚠ Wix MCP not configured — phase 6 will prompt user for manual DNS\n"
fi

# 10. Node + npm
check "Node v20+ available" "[ \"\$(node --version | sed 's/v//' | cut -d. -f1)\" -ge 20 ]"
check "npm available" "command -v npm"

# 11. Disk space ≥ 5 GB
FREE_KB=$(df -P -k . | awk 'NR==2 {print $4}')
if [[ "$FREE_KB" -ge 5242880 ]]; then
    printf "  ✓ Disk space ≥ 5 GB (have %d MB)\n" "$((FREE_KB / 1024))"
    PASS=$((PASS + 1))
else
    printf "  ✗ Disk space < 5 GB (have %d MB)\n" "$((FREE_KB / 1024))"
    FAILURES+=("disk-space")
    FAIL=$((FAIL + 1))
fi

echo "─────────────────────────────────────────────────────"
echo "  PASS: $PASS    FAIL: $FAIL"
if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "  Pre-flight failed — fix the following before deploying:"
    for f in "${FAILURES[@]}"; do echo "    - $f"; done
    exit 1
fi
exit 0
