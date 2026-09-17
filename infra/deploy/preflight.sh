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

# 2. CLIs — dashboard deploys to Cloudflare Workers (wrangler via npx), not Vercel.
# wrangler auth uses the CLOUDFLARE_API_TOKEN pulled from the vault at deploy time,
# so there's no separate "logged in" hard-fail here.
check "npx available (for wrangler)" "command -v npx"
check "Supabase CLI installed" "command -v supabase"
check "GitHub CLI installed"  "command -v gh"
check "GitHub CLI logged in"  "gh auth status"
check "Node v20+ available"   "[ \"\$(node --version | sed 's/v//' | cut -d. -f1)\" -ge 20 ]"
check "jq available"          "command -v jq"

# 3. Cloudflare target resolvable.
#
# This used to HARD FAIL when dashboard/wrangler.jsonc was absent — while deploy.sh's own phase 5
# says in as many words that its absence is "informational, not fatal", because a next-on-pages
# Pages deploy takes its target from `--project-name` and the Pages project settings, not from a
# repo config. The two contradicted each other and preflight won, so a repo that deploys perfectly
# well could not get past phase 1. The check now asks the question that actually matters — is there
# a Cloudflare target to deploy TO — which a wrangler config OR a --project-name in the deploy
# script answers.
check "Cloudflare target resolvable (dashboard)" \
    "[ -f ${PAYCRAFT_SRC}/dashboard/wrangler.jsonc ] || [ -f ${PAYCRAFT_SRC}/dashboard/wrangler.toml ] || grep -q 'project-name' ${PAYCRAFT_SRC}/dashboard/package.json"

# 4. Vault — required secrets for the Cloudflare deploy flow
SECRETS=(
    paycraft-encryption-key
    mbs-cloudflare-account-id
    mbs-cloudflare-pages-api-token
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

# 7. dev branch exists on remote
#
# This used to hard-fail on a missing origin/main, whose only justification was Phase 4 PROMOTE —
# retired 2026-09-14 when dev became the deploy branch. Keeping it would have blocked every deploy
# on a branch nothing reads. The branch that must exist is the one we actually ship.
cd "$PAYCRAFT_SRC"
if [ -n "$(git ls-remote --heads origin dev 2>/dev/null)" ]; then
    printf "  ✓ origin/dev exists (deploy branch)\n"; PASS=$((PASS + 1))
else
    printf "  ✗ origin/dev missing — there is nothing to deploy.\n"
    FAILURES+=("origin-dev-missing"); FAIL=$((FAIL + 1))
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
