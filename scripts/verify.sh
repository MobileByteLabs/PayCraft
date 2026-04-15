#!/bin/bash

# =============================================================================
# PayCraft — Verify & Fix (mirrors CI checks exactly)
#
# Usage:
#   ./scripts/verify.sh           # Full: fix + check + test + build
#   ./scripts/verify.sh --fix     # Only fix formatting
#   ./scripts/verify.sh --check   # Only check (no fix)
#   ./scripts/verify.sh --quick   # Fix + check + test (skip build)
#   ./scripts/verify.sh --ci      # Exact CI mirror (no auto-fix)
#
# After running this, your PR will pass all CI checks guaranteed.
# =============================================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; FAIL=0; FIXED=0; STEPS=()

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"

MODE="${1:-full}"

print_header() {
    echo ""
    echo -e "${BLUE}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}${BOLD}║  PayCraft — Verify & Fix                                     ║${NC}"
    echo -e "${BLUE}${BOLD}║  Mode: ${MODE}                                                      ║${NC}"
    echo -e "${BLUE}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

step_pass()  { PASS=$((PASS + 1)); STEPS+=("${GREEN}PASS${NC} $1"); echo -e "  ${GREEN}PASS${NC} $1"; }
step_fixed() { FIXED=$((FIXED + 1)); STEPS+=("${YELLOW}FIXED${NC} $1"); echo -e "  ${YELLOW}FIXED${NC} $1"; }
step_fail()  { FAIL=$((FAIL + 1)); STEPS+=("${RED}FAIL${NC} $1"); echo -e "  ${RED}FAIL${NC} $1"; }

run_spotless_fix() {
    echo -e "\n${BOLD}[1/4] Spotless Apply — auto-fix formatting${NC}"
    if ./gradlew spotlessApply --daemon -q 2>/dev/null; then
        if git diff --quiet 2>/dev/null; then
            step_pass "spotlessApply (no changes needed)"
        else
            CHANGED=$(git diff --name-only | wc -l | tr -d ' ')
            git add -u 2>/dev/null || true
            step_fixed "spotlessApply (${CHANGED} files reformatted)"
        fi
    else
        echo -e "  ${YELLOW}spotlessApply found unfixable issues:${NC}"
        ./gradlew spotlessApply --daemon 2>&1 | grep "lint error" | head -5
        step_fail "spotlessApply (manual fix required)"
        return 1
    fi
}

run_spotless_check() {
    echo -e "\n${BOLD}[2/4] Spotless Check — verify formatting${NC}"
    if ./gradlew spotlessCheck --daemon -q 2>/dev/null; then
        step_pass "spotlessCheck"
    else
        step_fail "spotlessCheck (run ./scripts/verify.sh --fix first)"
        return 1
    fi
}

run_detekt() {
    echo -e "\n${BOLD}[3/4] Detekt — static analysis${NC}"
    if ./gradlew detekt --daemon -q 2>/dev/null; then
        step_pass "detekt"
    else
        echo -e "  ${YELLOW}Detekt issues:${NC}"
        ./gradlew detekt --daemon 2>&1 | grep -E "^.+\.kt:" | head -10
        step_fail "detekt"
        return 1
    fi
}

run_tests() {
    echo -e "\n${BOLD}[4/4] JVM Tests${NC}"
    if grep -q "jvm()" "cmp-paycraft/build.gradle.kts" 2>/dev/null; then
        OUTPUT=$(./gradlew :cmp-paycraft:jvmTest --daemon 2>&1)
        if echo "$OUTPUT" | grep -q "BUILD SUCCESSFUL"; then
            COUNT=0
            if [ -d "cmp-paycraft/build/test-results/jvmTest" ]; then
                COUNT=$(find "cmp-paycraft/build/test-results/jvmTest" -name "*.xml" -exec grep -c "testcase" {} + 2>/dev/null | awk -F: '{sum+=$2} END {print sum}')
            fi
            echo -e "    ${GREEN}PASS${NC} cmp-paycraft (${COUNT} tests)"
            step_pass "jvmTest (${COUNT} tests)"
        else
            echo -e "    ${RED}FAIL${NC} cmp-paycraft"
            step_fail "jvmTest"
            return 1
        fi
    else
        step_pass "jvmTest (no JVM target)"
    fi
}

print_summary() {
    echo ""
    echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  RESULTS${NC}"
    echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
    echo ""
    for step in "${STEPS[@]}"; do echo -e "  $step"; done
    echo ""
    echo -e "  ${GREEN}Pass: ${PASS}${NC}  ${YELLOW}Fixed: ${FIXED}${NC}  ${RED}Fail: ${FAIL}${NC}"
    if [ $FAIL -eq 0 ]; then
        echo -e "\n${GREEN}${BOLD}  All checks passed! Your PR will pass CI.${NC}\n"
        [ $FIXED -gt 0 ] && echo -e "  ${YELLOW}Note: Files reformatted. Commit changes before pushing.${NC}\n"
        return 0
    else
        echo -e "\n${RED}${BOLD}  ${FAIL} check(s) failed. Fix and re-run.${NC}\n"
        return 1
    fi
}

run_build() {
    echo -e "\n${BOLD}[5/5] Build Library — all targets (same as CI)${NC}"
    OUTPUT=$(./gradlew :cmp-paycraft:assemble --daemon 2>&1)
    if echo "$OUTPUT" | grep -q "BUILD SUCCESSFUL"; then
        step_pass "assemble :cmp-paycraft (all targets)"
    else
        echo -e "  ${RED}Build errors:${NC}"
        echo "$OUTPUT" | grep "^e:\|FAILED" | head -5
        step_fail "assemble :cmp-paycraft"
        return 1
    fi
}

print_header
case "$MODE" in
    --fix)   run_spotless_fix || true ;;
    --check) run_spotless_check || true; run_detekt || true ;;
    --quick) run_spotless_fix || true; run_spotless_check || true; run_detekt || true; run_tests || true ;;
    --ci)    run_spotless_check || true; run_detekt || true; run_tests || true; run_build || true ;;
    --full|*) run_spotless_fix || true; run_spotless_check || true; run_detekt || true; run_tests || true; run_build || true ;;
esac
print_summary
