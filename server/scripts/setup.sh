#!/bin/bash
# PayCraft — One-Command Server Setup
# Usage:
#   ./setup.sh \
#     --provider stripe \
#     --supabase-ref YOUR_REF \
#     --supabase-token YOUR_TOKEN \
#     --stripe-secret-key sk_live_... \
#     --currency inr \
#     --plans "monthly:10000,quarterly:30000,yearly:100000"
#
# This script:
# 1. Applies migrations (subscriptions table + indexes + RLS)
# 2. Creates is_premium + get_subscription RPCs
# 3. Deploys the provider-specific webhook Edge Function
# 4. Sets provider secrets on the Edge Function
# 5. Outputs PayCraft.configure() code ready to paste

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1" >&2; }
log_step()    { echo -e "\n${BOLD}${CYAN}━━ $1 ━━${NC}"; }

# ── Script directory ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYCRAFT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$PAYCRAFT_ROOT/server/migrations"
FUNCTIONS_DIR="$PAYCRAFT_ROOT/server/functions"

# ── Defaults ─────────────────────────────────────────────────────────────────
PROVIDER=""
SUPABASE_REF=""
SUPABASE_TOKEN=""
STRIPE_SECRET_KEY=""
RAZORPAY_KEY_SECRET=""
CURRENCY="usd"
PLANS_INPUT=""

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider)          PROVIDER="$2"; shift 2 ;;
    --supabase-ref)      SUPABASE_REF="$2"; shift 2 ;;
    --supabase-token)    SUPABASE_TOKEN="$2"; shift 2 ;;
    --stripe-secret-key) STRIPE_SECRET_KEY="$2"; shift 2 ;;
    --razorpay-key)      RAZORPAY_KEY_SECRET="$2"; shift 2 ;;
    --currency)          CURRENCY="$2"; shift 2 ;;
    --plans)             PLANS_INPUT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --provider stripe|razorpay --supabase-ref <ref> --supabase-token <token> [options]"
      echo ""
      echo "Options:"
      echo "  --provider            Payment provider: stripe or razorpay"
      echo "  --supabase-ref        Supabase project reference (from project URL)"
      echo "  --supabase-token      Supabase access token (supabase.com/dashboard/account/tokens)"
      echo "  --stripe-secret-key   Stripe secret key (required for stripe provider)"
      echo "  --razorpay-key        Razorpay key secret (required for razorpay provider)"
      echo "  --currency            Currency code (default: usd)"
      echo "  --plans               Plan definitions: 'id:price_cents,...' e.g. 'monthly:999,yearly:9999'"
      exit 0
      ;;
    *) log_error "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validation ───────────────────────────────────────────────────────────────
validate_args() {
  local errors=0

  [[ -z "$PROVIDER" ]] && { log_error "--provider is required (stripe or razorpay)"; ((errors++)); }
  [[ -z "$SUPABASE_REF" ]] && { log_error "--supabase-ref is required"; ((errors++)); }
  [[ -z "$SUPABASE_TOKEN" ]] && { log_error "--supabase-token is required"; ((errors++)); }

  if [[ "$PROVIDER" == "stripe" && -z "$STRIPE_SECRET_KEY" ]]; then
    log_error "--stripe-secret-key is required for Stripe provider"
    ((errors++))
  fi

  if [[ "$PROVIDER" == "razorpay" && -z "$RAZORPAY_KEY_SECRET" ]]; then
    log_error "--razorpay-key is required for Razorpay provider"
    ((errors++))
  fi

  [[ $errors -gt 0 ]] && exit 1
}

# ── Supabase API helpers ─────────────────────────────────────────────────────
SUPABASE_API="https://api.supabase.com/v1"

supabase_request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local args=(-s -X "$method" \
    -H "Authorization: Bearer $SUPABASE_TOKEN" \
    -H "Content-Type: application/json")

  [[ -n "$data" ]] && args+=(-d "$data")

  curl "${args[@]}" "$SUPABASE_API$path"
}

get_project_db_url() {
  local result
  result=$(supabase_request GET "/projects/$SUPABASE_REF")
  echo "$result" | grep -o '"db_host":"[^"]*"' | cut -d'"' -f4
}

# ── Apply migrations via Supabase SQL endpoint ───────────────────────────────
apply_migration() {
  local sql_file="$1"
  local name="$2"

  log_info "Applying migration: $name"

  local sql_content
  sql_content=$(cat "$sql_file")

  local result
  result=$(supabase_request POST "/projects/$SUPABASE_REF/database/query" \
    "{\"query\": $(echo "$sql_content" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}")

  if echo "$result" | grep -q '"error"'; then
    log_error "Migration failed: $result"
    return 1
  fi

  log_success "Migration applied: $name"
}

apply_migrations() {
  log_step "Step 1: Apply Database Migrations"

  if [[ -f "$MIGRATIONS_DIR/001_create_subscriptions.sql" ]]; then
    apply_migration "$MIGRATIONS_DIR/001_create_subscriptions.sql" "001_create_subscriptions"
  else
    log_error "Migration file not found: $MIGRATIONS_DIR/001_create_subscriptions.sql"
    exit 1
  fi

  if [[ -f "$MIGRATIONS_DIR/002_create_rpcs.sql" ]]; then
    apply_migration "$MIGRATIONS_DIR/002_create_rpcs.sql" "002_create_rpcs"
  else
    log_error "Migration file not found: $MIGRATIONS_DIR/002_create_rpcs.sql"
    exit 1
  fi
}

# ── Deploy webhook Edge Function ─────────────────────────────────────────────
deploy_webhook() {
  log_step "Step 2: Deploy ${PROVIDER^} Webhook Edge Function"

  if ! command -v supabase &>/dev/null; then
    log_warn "Supabase CLI not found. Install it: https://supabase.com/docs/guides/cli"
    log_warn "Skipping webhook deployment. Run manually:"
    log_warn "  supabase functions deploy ${PROVIDER}-webhook --project-ref $SUPABASE_REF"
    return 0
  fi

  local function_dir="$FUNCTIONS_DIR/${PROVIDER}-webhook"

  if [[ ! -d "$function_dir" ]]; then
    log_error "Webhook function directory not found: $function_dir"
    exit 1
  fi

  log_info "Deploying ${PROVIDER}-webhook..."

  supabase functions deploy "${PROVIDER}-webhook" \
    --project-ref "$SUPABASE_REF" \
    --no-verify-jwt

  log_success "Webhook deployed: ${PROVIDER}-webhook"
}

# ── Set secrets ──────────────────────────────────────────────────────────────
set_secrets() {
  log_step "Step 3: Configure Webhook Secrets"

  if ! command -v supabase &>/dev/null; then
    log_warn "Supabase CLI not found. Set secrets manually in Supabase dashboard."
    log_warn "Edge Functions > ${PROVIDER}-webhook > Secrets"
    return 0
  fi

  if [[ "$PROVIDER" == "stripe" ]]; then
    log_info "Setting STRIPE_SECRET_KEY..."
    supabase secrets set STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
      --project-ref "$SUPABASE_REF"

    log_info "Setting up Stripe webhook secret..."
    log_warn "STRIPE_WEBHOOK_SECRET must be set manually after creating the webhook endpoint."
    log_warn "  1. Go to: https://dashboard.stripe.com/webhooks"
    log_warn "  2. Add endpoint: https://$SUPABASE_REF.functions.supabase.co/stripe-webhook"
    log_warn "  3. Copy the signing secret"
    log_warn "  4. Run: supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref $SUPABASE_REF"

  elif [[ "$PROVIDER" == "razorpay" ]]; then
    log_info "Setting RAZORPAY_KEY_SECRET..."
    supabase secrets set RAZORPAY_KEY_SECRET="$RAZORPAY_KEY_SECRET" \
      --project-ref "$SUPABASE_REF"

    log_warn "RAZORPAY_WEBHOOK_SECRET must be set manually."
    log_warn "  1. Go to: https://dashboard.razorpay.com/app/webhooks"
    log_warn "  2. Add endpoint: https://$SUPABASE_REF.functions.supabase.co/razorpay-webhook"
    log_warn "  3. Copy the webhook secret"
    log_warn "  4. Run: supabase secrets set RAZORPAY_WEBHOOK_SECRET=... --project-ref $SUPABASE_REF"
  fi

  log_success "Secrets configured"
}

# ── Generate PayCraft.configure() code ───────────────────────────────────────
generate_configure_code() {
  log_step "Step 4: Generate PayCraft.configure() Code"

  local supabase_url="https://${SUPABASE_REF}.supabase.co"
  local supabase_anon_key
  supabase_anon_key=$(supabase_request GET "/projects/$SUPABASE_REF/api-keys" | \
    grep -o '"anon_key":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "YOUR_ANON_KEY")

  echo ""
  echo -e "${BOLD}${GREEN}━━ Add this to your Application.onCreate() ━━${NC}"
  echo ""
  echo "PayCraft.configure {"
  echo "    supabase("
  echo "        url = \"$supabase_url\","
  echo "        anonKey = \"$supabase_anon_key\","
  echo "    )"

  if [[ "$PROVIDER" == "stripe" ]]; then
    echo "    provider("
    echo "        StripeProvider("
    echo "            paymentLinks = mapOf("

    if [[ -n "$PLANS_INPUT" ]]; then
      IFS=',' read -ra PLANS <<< "$PLANS_INPUT"
      for plan in "${PLANS[@]}"; do
        local plan_id="${plan%%:*}"
        echo "                \"$plan_id\" to \"https://buy.stripe.com/YOUR_${plan_id^^}_LINK\","
      done
    else
      echo "                \"monthly\" to \"https://buy.stripe.com/YOUR_MONTHLY_LINK\","
      echo "                \"yearly\" to \"https://buy.stripe.com/YOUR_YEARLY_LINK\","
    fi

    echo "            ),"
    echo "            customerPortalUrl = \"https://billing.stripe.com/p/login/YOUR_PORTAL_ID\","
    echo "        )"
    echo "    )"
  elif [[ "$PROVIDER" == "razorpay" ]]; then
    echo "    provider("
    echo "        RazorpayProvider("
    echo "            paymentLinks = mapOf("

    if [[ -n "$PLANS_INPUT" ]]; then
      IFS=',' read -ra PLANS <<< "$PLANS_INPUT"
      for plan in "${PLANS[@]}"; do
        local plan_id="${plan%%:*}"
        echo "                \"$plan_id\" to \"https://rzp.io/l/YOUR_${plan_id^^}_LINK\","
      done
    else
      echo "                \"monthly\" to \"https://rzp.io/l/YOUR_MONTHLY_LINK\","
      echo "                \"yearly\" to \"https://rzp.io/l/YOUR_YEARLY_LINK\","
    fi

    echo "            ),"
    echo "        )"
    echo "    )"
  fi

  echo "    plans("

  if [[ -n "$PLANS_INPUT" ]]; then
    local rank=1
    IFS=',' read -ra PLANS <<< "$PLANS_INPUT"
    for plan in "${PLANS[@]}"; do
      local plan_id="${plan%%:*}"
      local price_cents="${plan##*:}"
      local price_formatted
      case "$CURRENCY" in
        inr) price_formatted="₹$((price_cents / 100))" ;;
        usd) price_formatted="\$$((price_cents / 100))" ;;
        eur) price_formatted="€$((price_cents / 100))" ;;
        *)   price_formatted="$CURRENCY $((price_cents / 100))" ;;
      esac
      echo "        BillingPlan(id = \"$plan_id\", name = \"${plan_id^}\", price = \"$price_formatted\", interval = \"/$plan_id\", rank = $rank),"
      ((rank++))
    done
  else
    echo "        BillingPlan(id = \"monthly\", name = \"Monthly\", price = \"$9.99\", interval = \"/month\", rank = 1),"
    echo "        BillingPlan(id = \"yearly\", name = \"Yearly\", price = \"$79.99\", interval = \"/year\", rank = 2, isPopular = true),"
  fi

  echo "    )"
  echo "    benefits("
  echo "        BillingBenefit(icon = Icons.Default.Star, text = \"Unlock all features\"),"
  echo "        BillingBenefit(icon = Icons.Default.Block, text = \"Ad-free experience\"),"
  echo "    )"
  echo "    supportEmail(\"support@yourdomain.com\")"
  echo "}"
  echo ""

  echo -e "${BOLD}${GREEN}━━ Also add to your Koin modules ━━${NC}"
  echo ""
  echo "startKoin {"
  echo "    modules("
  echo "        appModules,"
  echo "        PayCraftModule,  // add this"
  echo "    )"
  echo "}"
  echo ""
}

# ── Verify setup ─────────────────────────────────────────────────────────────
verify_setup() {
  log_step "Step 5: Verify Setup"

  log_info "Checking subscriptions table..."
  local result
  result=$(supabase_request POST "/projects/$SUPABASE_REF/database/query" \
    '{"query": "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name = '\''subscriptions'\''"}')

  if echo "$result" | grep -q '"count":"1"'; then
    log_success "subscriptions table exists"
  else
    log_error "subscriptions table NOT found"
  fi

  log_info "Checking is_premium() RPC..."
  result=$(supabase_request POST "/projects/$SUPABASE_REF/database/query" \
    '{"query": "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = '\''public'\'' AND routine_name = '\''is_premium'\''"}')

  if echo "$result" | grep -q '"count":"1"'; then
    log_success "is_premium() RPC exists"
  else
    log_error "is_premium() RPC NOT found"
  fi

  log_info "Checking get_subscription() RPC..."
  result=$(supabase_request POST "/projects/$SUPABASE_REF/database/query" \
    '{"query": "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = '\''public'\'' AND routine_name = '\''get_subscription'\''"}')

  if echo "$result" | grep -q '"count":"1"'; then
    log_success "get_subscription() RPC exists"
  else
    log_error "get_subscription() RPC NOT found"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}PayCraft Server Setup${NC}"
  echo -e "${CYAN}Provider: ${PROVIDER^} | Supabase: $SUPABASE_REF | Currency: $CURRENCY${NC}"
  echo ""

  validate_args
  apply_migrations
  deploy_webhook
  set_secrets
  generate_configure_code
  verify_setup

  echo ""
  log_success "PayCraft server setup complete!"
  echo ""
  echo -e "Next steps:"
  echo -e "  1. Copy the PayCraft.configure() code above into your app"
  echo -e "  2. Add PayCraftModule to your Koin modules"
  echo -e "  3. Set your webhook signing secret (see instructions above)"
  echo -e "  4. Run: ${CYAN}./verify.sh --supabase-ref $SUPABASE_REF --token \$TOKEN${NC}"
  echo ""
}

main "$@"
