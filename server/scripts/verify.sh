#!/bin/bash
# PayCraft — End-to-End Verification
# Usage: ./verify.sh --supabase-ref <ref> --token <token> [--email test@example.com]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log_pass()  { echo -e "  ${GREEN}[PASS]${NC} $1"; }
log_fail()  { echo -e "  ${RED}[FAIL]${NC} $1"; FAILURES=$((FAILURES+1)); }
log_warn()  { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
log_info()  { echo -e "  ${BLUE}[INFO]${NC} $1"; }

SUPABASE_REF=""
SUPABASE_TOKEN=""
TEST_EMAIL=""
FAILURES=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --supabase-ref) SUPABASE_REF="$2"; shift 2 ;;
    --token)        SUPABASE_TOKEN="$2"; shift 2 ;;
    --email)        TEST_EMAIL="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

[[ -z "$SUPABASE_REF" ]] && { echo "Error: --supabase-ref required"; exit 1; }
[[ -z "$SUPABASE_TOKEN" ]] && { echo "Error: --token required"; exit 1; }

SUPABASE_API="https://api.supabase.com/v1"

supabase_query() {
  curl -s -X POST \
    -H "Authorization: Bearer $SUPABASE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$1\"}" \
    "$SUPABASE_API/projects/$SUPABASE_REF/database/query"
}

echo ""
echo -e "${BOLD}PayCraft Verification — $SUPABASE_REF${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check 1: Table exists
echo ""
echo -e "${BOLD}Schema Checks${NC}"
result=$(supabase_query "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_name='subscriptions'")
count=$(echo "$result" | grep -o '"cnt":"[^"]*"' | cut -d'"' -f4)
[[ "$count" == "1" ]] && log_pass "subscriptions table exists" || log_fail "subscriptions table MISSING"

# Check 2: RLS enabled
result=$(supabase_query "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='subscriptions'")
echo "$result" | grep -q '"rowsecurity":true' && log_pass "RLS enabled on subscriptions" || log_warn "RLS not confirmed (may need manual check)"

# Check 3: is_premium RPC
result=$(supabase_query "SELECT COUNT(*) AS cnt FROM information_schema.routines WHERE routine_schema='public' AND routine_name='is_premium'")
count=$(echo "$result" | grep -o '"cnt":"[^"]*"' | cut -d'"' -f4)
[[ "$count" == "1" ]] && log_pass "is_premium() RPC exists" || log_fail "is_premium() RPC MISSING"

# Check 4: get_subscription RPC
result=$(supabase_query "SELECT COUNT(*) AS cnt FROM information_schema.routines WHERE routine_schema='public' AND routine_name='get_subscription'")
count=$(echo "$result" | grep -o '"cnt":"[^"]*"' | cut -d'"' -f4)
[[ "$count" == "1" ]] && log_pass "get_subscription() RPC exists" || log_fail "get_subscription() RPC MISSING"

# Check 5: indexes
result=$(supabase_query "SELECT COUNT(*) AS cnt FROM pg_indexes WHERE tablename='subscriptions' AND indexname='idx_subscriptions_email'")
count=$(echo "$result" | grep -o '"cnt":"[^"]*"' | cut -d'"' -f4)
[[ "$count" == "1" ]] && log_pass "Email unique index exists" || log_warn "idx_subscriptions_email not found"

# Check 6: Test is_premium with test email
if [[ -n "$TEST_EMAIL" ]]; then
  echo ""
  echo -e "${BOLD}Function Tests${NC}"
  result=$(supabase_query "SELECT is_premium('$TEST_EMAIL') AS result")
  if echo "$result" | grep -q '"result":'; then
    log_pass "is_premium('$TEST_EMAIL') executes successfully"
  else
    log_fail "is_premium() function call failed: $result"
  fi

  result=$(supabase_query "SELECT * FROM get_subscription('$TEST_EMAIL') LIMIT 1")
  if ! echo "$result" | grep -q '"error"'; then
    log_pass "get_subscription('$TEST_EMAIL') executes successfully"
  else
    log_fail "get_subscription() function call failed: $result"
  fi
fi

# Check 7: Webhook functions deployed
if command -v supabase &>/dev/null; then
  echo ""
  echo -e "${BOLD}Edge Function Checks${NC}"
  functions=$(supabase functions list --project-ref "$SUPABASE_REF" 2>/dev/null || echo "")
  echo "$functions" | grep -q "stripe-webhook" && log_pass "stripe-webhook deployed" || log_warn "stripe-webhook not deployed (run setup.sh)"
  echo "$functions" | grep -q "razorpay-webhook" && log_pass "razorpay-webhook deployed" || log_info "razorpay-webhook not deployed (optional)"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All checks passed! PayCraft is ready.${NC}"
else
  echo -e "${RED}${BOLD}$FAILURES check(s) failed. Run setup.sh to fix.${NC}"
  exit 1
fi
echo ""
