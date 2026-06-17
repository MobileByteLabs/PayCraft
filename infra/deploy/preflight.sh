#!/usr/bin/env bash
#
# preflight.sh — Phase 1 of /paycraft-deploy (GitHub-integrated edition).
#
# Verifies the deploy can proceed. Hard-fails if any check fails.
#
# Usage: preflight.sh [--verbose]
#
set -eo pipefail

VERBOSE=false
[[ "${1:-}" = "--verbose" ]] && VERBOSE=true

PAYCRAFT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FW_ROOT="$(cd "$PAYCRAFT_SRC/../../../../.." && pwd)"

PASS=0
FAIL=0
declare -a FAILURES

check() {
    local name="$1" cmd="$2" hard="${3:-true}"
    if eval "$cmd" >/dev/null 2>&1; then
        printf "  ✓ %s\n" "$name"; PASS=$((PASS + 1))
    else
        if [[ "$hard" = "true" ]]; then
            printf "  ✗ %s  (HARD FAIL)\n" "$name"; FAILURES+=("$name"); FAIL=$((FAIL + 1))
        else
            printf "  ⚠ %s  (warn only)\n" "$name"
        fi
        [[ "$VERBOSE" = "true" ]] && eval "$cmd" 2>&1 | sed 's/^/      /'
    fi
}

echo "─── Phase 1: PRE-FLIGHT ───────────────────────────────"

# 1. Active project bound
check "Active project = mbs/PayCraft" \
    "[ \"\$(bash ${FW_ROOT}/core/scripts/session-resolve.sh)\" = mbs/PayCraft ]"

# 2. CLIs
check "Vercel CLI installed" "command -v vercel"
check "Vercel CLI logged in" "vercel whoami"
check "Supabase CLI installed" "command -v supabase"
check "GitHub CLI installed"  "command -v gh"
check "GitHub CLI logged in"  "gh auth status"
check "Node v20+ available"   "[ \"\$(node --version | sed 's/v//' | cut -d. -f1)\" -ge 20 ]"
check "jq available"          "command -v jq"

# 3. Vercel project linked (project.json present)
check "Vercel project linked (dashboard)" \
    "[ -f ${PAYCRAFT_SRC}/dashboard/.vercel/project.json ]"

# 4. Vault — 5 required secrets for the GitHub-integrated flow
SECRETS=(
    mbs-paycraft-encryption-key
    mbs-paycraft-resend-api-key
    mbs-paycraft-vercel-token
    mbs-paycraft-vercel-org-id
    mbs-paycraft-vercel-project-id
)
MISSING=()
for a in "${SECRETS[@]}"; do
    local_chk=$(mktemp -t v-pre-XXXXXX); chmod 600 "$local_chk"
    if ! bash "${FW_ROOT}/core/scripts/secrets-get.sh" "$a" --to-file "$local_chk" 2>/dev/null; then
        MISSING+=("$a")
    fi
    rm -f "$local_chk"
done
if [[ ${#MISSING[@]} -eq 0 ]]; then
    printf "  ✓ All %d PayCraft vault secrets present\n" "${#SECRETS[@]}"; PASS=$((PASS + 1))
else
    printf "  ✗ Missing vault secrets (%d):\n" "${#MISSING[@]}"
    for m in "${MISSING[@]}"; do printf "      - %s\n" "$m"; done
    FAILURES+=("vault-secrets-missing-${#MISSING[@]}"); FAIL=$((FAIL + 1))
fi

# 5. framework-supabase reachability via vault (no `supabase login` needed)
TF=$(mktemp -t fw-db-XXXXXX); chmod 600 "$TF"
if bash "${FW_ROOT}/core/scripts/secrets-get.sh" framework-supabase-db-url --to-file "$TF" 2>/dev/null; then
    printf "  ✓ framework-supabase-db-url resolvable from vault\n"; PASS=$((PASS + 1))
else
    printf "  ✗ framework-supabase-db-url not in vault\n"
    FAILURES+=("framework-supabase-db-url"); FAIL=$((FAIL + 1))
fi
rm -f "$TF"

# 6. Custom domain reachable (DNS + SSL)
if curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "https://paycraft.mobilebytesensei.com/" 2>/dev/null | grep -qE "^(200|307|308|404)$"; then
    printf "  ✓ paycraft.mobilebytesensei.com reachable (DNS + SSL OK)\n"; PASS=$((PASS + 1))
else
    printf "  ⚠ paycraft.mobilebytesensei.com unreachable — first-deploy is OK; otherwise check DNS\n"
fi

# 7. main branch exists on remote
cd "$PAYCRAFT_SRC"
if git ls-remote --heads origin main >/dev/null 2>&1 && [ -n "$(git ls-remote --heads origin main)" ]; then
    printf "  ✓ origin/main exists\n"; PASS=$((PASS + 1))
else
    printf "  ✗ origin/main missing — Phase 4 PROMOTE will fail. Create with: git checkout -b main && git push -u origin main\n"
    FAILURES+=("origin-main-missing"); FAIL=$((FAIL + 1))
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
