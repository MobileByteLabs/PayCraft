#!/bin/bash
# PayCraft — Deploy a specific webhook Edge Function
# Usage: ./deploy-webhook.sh stripe|razorpay --supabase-ref <ref> [--stripe-key <key>]

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="$(cd "$SCRIPT_DIR/../functions" && pwd)"

PROVIDER="${1:-}"
SUPABASE_REF=""; SUPABASE_TOKEN=""; STRIPE_KEY=""; RAZORPAY_KEY=""

shift || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --supabase-ref) SUPABASE_REF="$2"; shift 2 ;;
    --token)        SUPABASE_TOKEN="$2"; shift 2 ;;
    --stripe-key)   STRIPE_KEY="$2"; shift 2 ;;
    --razorpay-key) RAZORPAY_KEY="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

[[ -z "$PROVIDER" ]] && { echo -e "${RED}Usage: $0 stripe|razorpay --supabase-ref <ref> --token <token>${NC}"; exit 1; }
[[ -z "$SUPABASE_REF" ]] && { echo -e "${RED}--supabase-ref required${NC}"; exit 1; }

if ! command -v supabase &>/dev/null; then
  echo -e "${RED}Supabase CLI required. Install: https://supabase.com/docs/guides/cli${NC}"
  exit 1
fi

echo -e "${GREEN}Deploying ${PROVIDER}-webhook to $SUPABASE_REF...${NC}"

supabase functions deploy "${PROVIDER}-webhook" \
  --project-ref "$SUPABASE_REF" \
  --no-verify-jwt

if [[ "$PROVIDER" == "stripe" && -n "$STRIPE_KEY" ]]; then
  echo "Setting STRIPE_SECRET_KEY..."
  supabase secrets set STRIPE_SECRET_KEY="$STRIPE_KEY" --project-ref "$SUPABASE_REF"
elif [[ "$PROVIDER" == "razorpay" && -n "$RAZORPAY_KEY" ]]; then
  echo "Setting RAZORPAY_KEY_SECRET..."
  supabase secrets set RAZORPAY_KEY_SECRET="$RAZORPAY_KEY" --project-ref "$SUPABASE_REF"
fi

echo -e "${GREEN}✓ ${PROVIDER}-webhook deployed!${NC}"
echo ""
echo "Webhook URL: https://$SUPABASE_REF.functions.supabase.co/${PROVIDER}-webhook"
echo ""
if [[ "$PROVIDER" == "stripe" ]]; then
  echo -e "${YELLOW}Next: Add webhook endpoint in Stripe Dashboard and set STRIPE_WEBHOOK_SECRET${NC}"
elif [[ "$PROVIDER" == "razorpay" ]]; then
  echo -e "${YELLOW}Next: Add webhook endpoint in Razorpay Dashboard and set RAZORPAY_WEBHOOK_SECRET${NC}"
fi
