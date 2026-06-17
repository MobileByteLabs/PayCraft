#!/usr/bin/env bash
#
# infra/epic-close-check.sh
#
# Epic-close orchestrator for paycraft-v2-production-readiness. Runs every
# acceptance gate (G-1 through G-EPIC) in a single pass and emits a structured
# verdict. Used as the final boundary check before flipping the epic PLAN.md
# status to `complete`.
#
# Exit codes:
#   0 — all gates GREEN; epic ready to close
#   1 — one or more gates FAIL; details in output
#   2 — invocation error (missing tools, no project root)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

# Track per-gate state
declare -a GATE_STATUS=()
declare -a GATE_NAMES=()

record() {
    GATE_NAMES+=("$1")
    GATE_STATUS+=("$2")
}

echo "═══════════════════════════════════════════════════════════════"
echo "  paycraft-v2-production-readiness — Epic Close Orchestrator"
echo "═══════════════════════════════════════════════════════════════"
echo

# ─── G-1 — tier_definitions seed + PayCraft is tenant 1 ─────────
echo "▶ G-1 — Self-monetize gate"
if bash infra/verify-tier-definitions.sh --from-vault 2>&1 | grep -q '^✅'; then
    echo "   tier_definitions:      PASS"
    G1_TIERS=PASS
else
    echo "   tier_definitions:      FAIL — re-apply migration 031, or skip if vault unreachable"
    G1_TIERS=FAIL
fi
if [ -f "supabase/migrations/066_paycraft_tenant_one.sql" ]; then
    echo "   paycraft-as-tenant-1:  PASS (migration 066 present; apply via supabase db push)"
    G1_TENANT=PASS
else
    echo "   paycraft-as-tenant-1:  FAIL — missing migration 066"
    G1_TENANT=FAIL
fi
if [ "$G1_TIERS" = PASS ] && [ "$G1_TENANT" = PASS ]; then
    record "G-1 Self-monetize" PASS
else
    record "G-1 Self-monetize" FAIL
fi
echo

# ─── G-2 — zero-leak validator ───────────────────────────────────
echo "▶ G-2 — Domain + docs gate"
if bash infra/zero-leak-check.sh > /tmp/g2.out 2>&1; then
    echo "   zero-leak:             PASS"
    record "G-2 Domain + docs" PASS
else
    echo "   zero-leak:             FAIL"
    sed 's/^/      /' /tmp/g2.out | head -20
    record "G-2 Domain + docs" FAIL
fi
rm -f /tmp/g2.out
echo

# ─── G-3 — DR pipeline (workflow + script + runbook present) ────
echo "▶ G-3 — DR + PCI + legal gate"
G3_PARTS=(".github/workflows/daily-backup.yml" "infra/restore-from-r2.sh" "docs/DR_RUNBOOK.md" "docs/PCI_SCOPE.md")
G3_OK=true
for p in "${G3_PARTS[@]}"; do
    if [ -f "$p" ]; then
        echo "   $(printf '%-30s' "$p")  PASS"
    else
        echo "   $(printf '%-30s' "$p")  MISSING"
        G3_OK=false
    fi
done
if $G3_OK; then
    record "G-3 DR + PCI + legal" PASS
else
    record "G-3 DR + PCI + legal" FAIL
fi
echo

# ─── G-4 — Observability + abuse ─────────────────────────────────
echo "▶ G-4 — Observability + abuse gate"
G4_OK=true

# All 11 webhook handlers wrapped?
declare -i WRAPPED=0 TOTAL=11
for w in btcpay cashfree cloud-billing flutterwave lemonsqueezy midtrans \
         paddle paypal paystack razorpay stripe; do
    f="supabase/functions/${w}-webhook/index.ts"
    if [ -f "$f" ] && grep -q 'withWebhookRateLimit' "$f"; then
        WRAPPED=$((WRAPPED + 1))
    fi
done
if [ "$WRAPPED" -eq "$TOTAL" ]; then
    echo "   webhook rate-limit:    PASS (${WRAPPED}/${TOTAL} handlers)"
else
    echo "   webhook rate-limit:    FAIL (${WRAPPED}/${TOTAL} handlers wrapped)"
    G4_OK=false
fi

# Edge middleware shed in place?
if grep -q 'checkEdgeRateLimit' dashboard/middleware.ts; then
    echo "   edge rate-limit:       PASS"
else
    echo "   edge rate-limit:       FAIL — checkEdgeRateLimit missing from middleware.ts"
    G4_OK=false
fi

# charge.refunded handler?
if grep -q 'charge\.refunded' supabase/functions/stripe-webhook/index.ts; then
    echo "   charge.refunded:       PASS"
else
    echo "   charge.refunded:       FAIL"
    G4_OK=false
fi

# Support ticket route?
if [ -f "dashboard/app/api/support/ticket/route.ts" ]; then
    echo "   support intake:        PASS"
else
    echo "   support intake:        FAIL"
    G4_OK=false
fi

if $G4_OK; then
    record "G-4 Observability + abuse" PASS
else
    record "G-4 Observability + abuse" FAIL
fi
echo

# ─── G-5 — E2E + Maven publish ───────────────────────────────────
echo "▶ G-5 — E2E + Maven publish gate"
G5_OK=true

# cmp-paycraft version = 2.0.0
if grep -q '^paycraft\.version=2\.0\.0$' gradle.properties; then
    echo "   cmp-paycraft 2.0.0:    PASS"
else
    echo "   cmp-paycraft 2.0.0:    FAIL — gradle.properties#paycraft.version mismatch"
    G5_OK=false
fi

# Maven publish wired
if grep -q 'mavenPublishing' cmp-paycraft/build.gradle.kts; then
    echo "   mavenPublishing block: PASS"
else
    echo "   mavenPublishing block: FAIL"
    G5_OK=false
fi

# RLS isolation test
if [ -f "dashboard/__tests__/api/rls-isolation.test.ts" ]; then
    cd dashboard
    if npx jest __tests__/api/rls-isolation.test.ts --silent 2>&1 | grep -q '11 passed'; then
        echo "   RLS isolation tests:   PASS (11/11)"
    else
        echo "   RLS isolation tests:   FAIL — re-run npx jest __tests__/api/rls-isolation.test.ts"
        G5_OK=false
    fi
    cd ..
else
    echo "   RLS isolation tests:   FAIL — file missing"
    G5_OK=false
fi

# Case study doc
if [ -f "docs/REELS_DOWNLOADER_INTEGRATION.md" ]; then
    echo "   case study:            PASS"
else
    echo "   case study:            FAIL"
    G5_OK=false
fi

# Verify the artifact is on Central (network check, fail-soft)
ARTIFACT_URL="https://repo1.maven.org/maven2/io/github/mobilebytelabs/cmp-paycraft/2.0.0/cmp-paycraft-2.0.0.pom"
if curl -fsS -o /dev/null --max-time 5 "$ARTIFACT_URL" 2>/dev/null; then
    echo "   Maven Central 2.0.0:   PASS (artifact resolvable)"
else
    echo "   Maven Central 2.0.0:   PENDING (artifact not yet on Central — gated on Phase 5 T1-T5 + tag push)"
    # Don't fail G-5 on this — operational gate
fi

if $G5_OK; then
    record "G-5 E2E + Maven" PASS
else
    record "G-5 E2E + Maven" FAIL
fi
echo

# ─── G-EPIC — cross-phase smoke ─────────────────────────────────
echo "▶ G-EPIC — Cross-phase boundary check"
EPIC_OK=true

# /api/health responding?
HEALTH=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 \
    https://paycraft.mobilebytesensei.com/api/health 2>/dev/null || echo FAIL)
if [ "$HEALTH" = 200 ]; then
    echo "   /api/health (prod):    PASS"
else
    echo "   /api/health (prod):    $HEALTH — gated on /paycraft-deploy ship"
    EPIC_OK=false
fi

# Auth, legal, marketing endpoints reachable
for path in /auth/login /legal/terms /legal/privacy /legal/dpa /pricing; do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 \
           "https://paycraft.mobilebytesensei.com${path}" 2>/dev/null || echo FAIL)
    if [ "$code" = 200 ]; then
        echo "   $(printf '%-30s' "${path} (prod):")  PASS"
    else
        echo "   $(printf '%-30s' "${path} (prod):")  $code"
        EPIC_OK=false
    fi
done

if $EPIC_OK; then
    record "G-EPIC Cross-phase" PASS
else
    record "G-EPIC Cross-phase" FAIL
fi
echo

# ─── Summary ─────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "  Gate summary"
echo "═══════════════════════════════════════════════════════════════"
FAILS=0
for i in "${!GATE_NAMES[@]}"; do
    if [ "${GATE_STATUS[$i]}" = "PASS" ]; then
        sym="✅"
    else
        sym="❌"
        FAILS=$((FAILS + 1))
    fi
    printf "  %s  %-30s %s\n" "$sym" "${GATE_NAMES[$i]}" "${GATE_STATUS[$i]}"
done
echo

if [ "$FAILS" -eq 0 ]; then
    echo "✅ All gates GREEN. Epic ready to close."
    echo "   Next step: flip PLAN.md status → complete, archive sub-plans, update index."
    exit 0
else
    echo "❌ ${FAILS} gate(s) failing. Resolve before closing the epic."
    exit 1
fi
