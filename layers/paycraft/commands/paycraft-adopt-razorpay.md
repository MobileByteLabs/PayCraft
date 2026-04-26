# paycraft-adopt-razorpay — Phase 3B: Razorpay Setup

> **PHASE 3B of 5 (Razorpay path)** — Creates subscription plans, payment links, webhook.
> 4 steps + 1 user action gate. Use TEST/sandbox credentials throughout.
> Runs INSTEAD of Phase 3 when PAYCRAFT_PROVIDER=razorpay.

---

## Prerequisites (verify before starting)

Read `.env` → confirm:
- `PAYCRAFT_PROVIDER` = "razorpay"
- `PAYCRAFT_RAZORPAY_KEY_ID` starts with "rzp_test_" or "rzp_live_"
- `PAYCRAFT_RAZORPAY_KEY_SECRET` is non-empty
- `PAYCRAFT_PLAN_COUNT` ≥ 1
- `PAYCRAFT_CURRENCY` is non-empty

---

## Phase 3B Steps

### STEP 3B.1 — Verify Razorpay connection

```
ACTION  : GET https://api.razorpay.com/v1/customers?count=1
          Auth: Basic [PAYCRAFT_RAZORPAY_KEY_ID]:[PAYCRAFT_RAZORPAY_KEY_SECRET]
VERIFY  : HTTP 200
IF HTTP 401:
  HARD STOP: "Razorpay credentials invalid.
              Check PAYCRAFT_RAZORPAY_KEY_ID and PAYCRAFT_RAZORPAY_KEY_SECRET.
              Get keys at: https://dashboard.razorpay.com/app/keys"
IF HTTP 403:
  HARD STOP: "Razorpay API access denied.
              Check if your Razorpay account is active and keys have API access."
OUTPUT  : "✓ Razorpay connected"
```

### STEP 3B.2 — Create subscription plans

```
READ    : PAYCRAFT_PLAN_COUNT, PAYCRAFT_CURRENCY from .env

FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_PLAN_[i]_NAME, PAYCRAFT_PLAN_[i]_PRICE from .env

  DETERMINE period/interval — read PAYCRAFT_PLAN_[i]_INTERVAL from .env:
    READ: PAYCRAFT_PLAN_[i]_INTERVAL (e.g. "/month", "/year", "/3 months", "monthly")
    MAP:
      contains "month" AND NOT contains "3" → period=monthly, interval=1
      contains "3" AND contains "month"     → period=monthly, interval=3
      contains "quarter"                    → period=monthly, interval=3
      contains "year"                       → period=yearly,  interval=1
      else → ask user: "How often is [plan_id] billed?
                        [1] Monthly (every month)
                        [2] Quarterly (every 3 months)
                        [3] Yearly (every year)"

  ACTION  : POST https://api.razorpay.com/v1/plans
            Auth: Basic [KEY_ID]:[KEY_SECRET]
            Body:
            {
              "period": "[monthly/yearly]",
              "interval": [1/3],
              "item": {
                "name": "[PAYCRAFT_PLAN_[i]_NAME]",
                "amount": [PAYCRAFT_PLAN_[i]_PRICE],
                "unit_amount": [PAYCRAFT_PLAN_[i]_PRICE],
                "currency": "[PAYCRAFT_CURRENCY]",
                "description": "PayCraft [plan_name] plan"
              },
              "notes": {"paycraft_plan": "[plan_id]", "paycraft_test": "true"}
            }
  VERIFY  : HTTP 200 AND response.id starts with "plan_"
  IF HTTP 400:
    HARD STOP: "Razorpay plan creation failed.
                Error: [response body]
                Check currency code ([PAYCRAFT_CURRENCY]) and amount format."
  CAPTURE : response.id → write PAYCRAFT_RAZORPAY_PLAN_[PLAN_ID]=[plan_id] to .env

  VERIFY  : GET https://api.razorpay.com/v1/plans/[plan_id]
            → response.id = [plan_id] AND response.item.amount = [price]
  IF MISMATCH:
    HARD STOP: "Plan [plan_id] created but verification failed.
                Expected amount: [price], got: [actual]"
  OUTPUT  : "  ✓ Plan [plan_name]: [plan_id] ([amount] [currency])"

OUTPUT : "✓ [N] Razorpay plans created"
```

### STEP 3B.3 — Create Payment Links

```
FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_PLAN_[i]_NAME,
        PAYCRAFT_PLAN_[i]_PRICE, PAYCRAFT_RAZORPAY_PLAN_[PLAN_ID] from .env

  ACTION  : POST https://api.razorpay.com/v1/payment_links
            Auth: Basic [KEY_ID]:[KEY_SECRET]
            Body:
            {
              "amount": [PAYCRAFT_PLAN_[i]_PRICE],
              "currency": "[PAYCRAFT_CURRENCY]",
              "description": "[PAYCRAFT_PLAN_[i]_NAME] subscription — PayCraft",
              "callback_url": "[PAYCRAFT_APP_REDIRECT_URL]",
              "callback_method": "get",
              "notes": {"paycraft_plan": "[plan_id]", "paycraft_test": "true"}
            }
  VERIFY  : HTTP 200 AND response.short_url is non-empty
  IF HTTP 400:
    HARD STOP: "Payment link creation failed.
                Error: [response body]"
  CAPTURE : response.short_url → write PAYCRAFT_RAZORPAY_LINK_[PLAN_ID]=[url] to .env

  VERIFY  : GET https://api.razorpay.com/v1/payment_links/[response.id]
            → response.status = "created" AND response.short_url non-empty
  IF VERIFY FAILS:
    HARD STOP: "Payment link [plan_id] created but verification failed."
  OUTPUT  : "  ✓ Payment link [plan_name]: [short_url]"

VERIFY : Re-read .env → all PAYCRAFT_RAZORPAY_LINK_* keys non-empty
OUTPUT : "✓ [N] Razorpay payment links created and saved to .env"
```

### STEP 3B.4 — Create Webhook endpoint (USER ACTION GATE)

```
USER ACTION GATE:
  DISPLAY:
    "Create the webhook endpoint in Razorpay Dashboard:"
    ""
    "1. Open: https://dashboard.razorpay.com/app/webhooks"
    "   (Use Test mode if testing)"
    ""
    "2. Click '+ Add New Webhook'"
    ""
    "3. Webhook URL:"
    "   [PAYCRAFT_SUPABASE_URL]/functions/v1/razorpay-webhook"
    ""
    "4. Select these events:"
    "   ✓ payment.captured"
    "   ✓ subscription.activated"
    "   ✓ subscription.cancelled"
    "   ✓ subscription.completed"
    ""
    "5. Under 'Secret', enter a webhook secret (minimum 8 characters)"
    "   Write it down — you'll need to paste it below"
    ""
    "6. Click 'Create Webhook'"
    ""
    "7. Paste your webhook secret here:"

WAIT: user pastes webhook secret
VALIDATE: length ≥ 8
IF TOO SHORT:
  HARD STOP: "Webhook secret must be at least 8 characters."

ACTION  : Write PAYCRAFT_RAZORPAY_WEBHOOK_SECRET=[value] to .env
ACTION  : supabase secrets set RAZORPAY_WEBHOOK_SECRET=[value]
            --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
VERIFY  : supabase secrets list --project-ref [ref] | grep RAZORPAY_WEBHOOK_SECRET
IF NOT FOUND:
  HARD STOP: "RAZORPAY_WEBHOOK_SECRET not set on Supabase function."
VERIFY  : Re-read .env → PAYCRAFT_RAZORPAY_WEBHOOK_SECRET non-empty
OUTPUT  : "✓ Razorpay webhook secret: set in .env + Supabase function secrets"
```

---

## Phase 3B Checkpoint

```
╔══ PHASE 3B COMPLETE — Razorpay Setup ═══════════════════════════════╗
║                                                                       ║
║  ✓ Razorpay connected                                                ║
║  ✓ Subscription plans created ([N] plans):                           ║
║    [list: plan_name → plan_id]                                       ║
║  ✓ Payment links created ([N] links):                                ║
║    [list: plan_name → short_url]                                     ║
║  ✓ Webhook endpoint created in Razorpay Dashboard                    ║
║  ✓ Webhook secret: set in .env + Supabase function secrets           ║
║                                                                       ║
║  Ready to proceed to Phase 4: Client Integration?                    ║
║  [Y] Continue   [Q] Quit                                             ║
╚═══════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding.
