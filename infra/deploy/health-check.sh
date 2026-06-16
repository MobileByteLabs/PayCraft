#!/usr/bin/env bash
#
# health-check.sh — Phase 8 of /paycraft-deploy.
#
# Verifies the live deployment is healthy.
#
# Usage:
#   health-check.sh [URL]              # default: https://paycraft.mobilebytesensei.com
#   health-check.sh --vercel-only      # use .last-deploy-url instead (pre-DNS)
#
set -eo pipefail

DEFAULT_URL="https://paycraft.mobilebytesensei.com"
LAST_DEPLOY_URL=$(cat "$(dirname "${BASH_SOURCE[0]}")/.last-deploy-url" 2>/dev/null || echo "")

URL="${1:-$DEFAULT_URL}"
if [[ "$1" = "--vercel-only" ]]; then
    URL="$LAST_DEPLOY_URL"
    [[ -z "$URL" ]] && { echo "ERROR: --vercel-only requires .last-deploy-url"; exit 1; }
fi

echo "─── Phase 8: HEALTH CHECK ─────────────────────────────"
echo "  Target: $URL"

PASS=0
FAIL=0

# 1. Root URL returns 200
echo -n "  → Root URL HTTP status: "
ROOT_STATUS=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 15 "$URL" 2>/dev/null || echo "000")
if [[ "$ROOT_STATUS" = "200" ]] || [[ "$ROOT_STATUS" = "307" ]] || [[ "$ROOT_STATUS" = "308" ]]; then
    echo "$ROOT_STATUS ✓"
    PASS=$((PASS + 1))
else
    echo "$ROOT_STATUS ✗ (expected 200/307/308)"
    FAIL=$((FAIL + 1))
fi

# 2. /api/health endpoint (if exists)
echo -n "  → /api/health: "
HEALTH_BODY=$(curl -fsS --max-time 10 "$URL/api/health" 2>/dev/null || echo "")
if [[ -n "$HEALTH_BODY" ]]; then
    if echo "$HEALTH_BODY" | grep -qE '"status"[[:space:]]*:[[:space:]]*"ok"'; then
        echo "ok ✓"
        PASS=$((PASS + 1))
    else
        echo "responded but status != ok"
        echo "    body: $HEALTH_BODY"
        FAIL=$((FAIL + 1))
    fi
else
    echo "endpoint not implemented or unreachable (skip)"
fi

# 3. /auth/login page renders (skipped if not configured)
echo -n "  → /auth/login renders: "
LOGIN_HTML=$(curl -fsS --max-time 15 "$URL/auth/login" 2>/dev/null || echo "")
if echo "$LOGIN_HTML" | grep -qiE '(google|sign.?in|paycraft)'; then
    echo "✓"
    PASS=$((PASS + 1))
else
    echo "✗ — page did not contain expected markers"
    FAIL=$((FAIL + 1))
fi

# 4. SSL cert valid
echo -n "  → SSL cert valid: "
DOMAIN=$(echo "$URL" | sed -E 's|https?://||' | cut -d/ -f1)
if echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
    | openssl x509 -noout -checkend 0 >/dev/null 2>&1; then
    echo "✓"
    PASS=$((PASS + 1))
else
    echo "✗ — cert invalid or not yet provisioned"
    FAIL=$((FAIL + 1))
fi

# 5. Playwright smoke (per RULE-WEB-DEBUG-001)
if [[ -z "${SKIP_PLAYWRIGHT:-}" ]] && [[ -f "$(dirname "${BASH_SOURCE[0]}")/../../../../../../.claude-runtime/scripts/web-debug-bootstrap.sh" ]]; then
    echo -n "  → Playwright smoke: "
    BOOTSTRAP="$(dirname "${BASH_SOURCE[0]}")/../../../../../../.claude-runtime/scripts/web-debug-bootstrap.sh"

    # Compose smoke test inline
    SMOKE_TS=$(mktemp -t paycraft-smoke-XXXXXX.ts)
    cat > "$SMOKE_TS" <<EOF
import { chromium } from 'playwright'
const url = '$URL'
const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const resp = await page.goto(url + '/auth/login', { waitUntil: 'networkidle', timeout: 30000 })
const status = resp?.status() ?? 0
const title = await page.title()
const hasGoogleButton = (await page.locator('button:has-text("Google"), a:has-text("Google"), [data-testid*="google"]').count()) > 0
await browser.close()
if (status >= 400) { console.log('FAIL: status=' + status); process.exit(1) }
if (errors.length > 0) { console.log('FAIL: console errors: ' + errors.join(' | ')); process.exit(1) }
console.log('OK status=' + status + ' title="' + title + '" googleBtn=' + hasGoogleButton)
EOF
    if bash "$BOOTSTRAP" run "$SMOKE_TS" 2>&1 | tail -5 | grep -q '^OK'; then
        echo "✓"
        PASS=$((PASS + 1))
    else
        echo "✗"
        FAIL=$((FAIL + 1))
    fi
    rm -f "$SMOKE_TS"
else
    echo "  → Playwright smoke: skipped (SKIP_PLAYWRIGHT=1 or bootstrap missing)"
fi

echo "─────────────────────────────────────────────────────"
echo "  PASS: $PASS    FAIL: $FAIL"
exit $((FAIL > 0))
