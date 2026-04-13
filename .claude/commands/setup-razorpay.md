# /setup-razorpay — Razorpay Payment Links

Child command called by `/setup-paycraft` Step 3 when provider = razorpay.

## Prerequisites

`.env` must exist with:
- `PAYCRAFT_RAZORPAY_KEY_ID`
- `PAYCRAFT_RAZORPAY_KEY_SECRET`
- `PAYCRAFT_CURRENCY`
- `PAYCRAFT_APP_REDIRECT_URL`

## Method

Razorpay has no MCP — always uses REST API. Load credentials from `.env`.

---

## Step 1: Create Payment Links

For each plan (monthly, quarterly, yearly):

```bash
# Monthly example — repeat for quarterly and yearly with different amount/description
curl -s -X POST https://api.razorpay.com/v1/payment_links \
  -u "${PAYCRAFT_RAZORPAY_KEY_ID}:${PAYCRAFT_RAZORPAY_KEY_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{
    \"amount\": 9900,
    \"currency\": \"${PAYCRAFT_CURRENCY^^}\",
    \"description\": \"PayCraft Monthly Subscription\",
    \"callback_url\": \"${PAYCRAFT_APP_REDIRECT_URL}\",
    \"callback_method\": \"get\",
    \"reminder_enable\": false,
    \"notify\": { \"sms\": false, \"email\": false }
  }"
```

Extract `short_url` from each response.

---

## Step 2: Save to .env

Use Edit tool to update `.env`:
```
PAYCRAFT_RAZORPAY_LINK_MONTHLY=https://rzp.io/l/...
PAYCRAFT_RAZORPAY_LINK_QUARTERLY=https://rzp.io/l/...
PAYCRAFT_RAZORPAY_LINK_YEARLY=https://rzp.io/l/...
```

---

## Step 3: Webhook Registration Instructions

Output to user:
> Register webhook in Razorpay Dashboard:
> URL: `https://${PAYCRAFT_SUPABASE_PROJECT_REF}.functions.supabase.co/razorpay-webhook`
>
> Go to: https://dashboard.razorpay.com/app/webhooks → Add New Webhook
>
> Events to select:
> - payment.captured
> - subscription.activated
> - subscription.cancelled
> - subscription.charged
>
> Set a webhook secret, then add to `.env`:
> `PAYCRAFT_RAZORPAY_WEBHOOK_SECRET=...`
>
> Then set it in Supabase:
> `supabase secrets set RAZORPAY_WEBHOOK_SECRET="${PAYCRAFT_RAZORPAY_WEBHOOK_SECRET}" --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}"`

## Output

```
✅ Razorpay setup complete
   Monthly link:   https://rzp.io/l/...
   Quarterly link: https://rzp.io/l/...
   Yearly link:    https://rzp.io/l/...
   Webhook:        Register at https://dashboard.razorpay.com/app/webhooks
```
