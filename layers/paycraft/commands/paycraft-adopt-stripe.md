# paycraft-adopt-stripe — Phase 3: Stripe Setup

> **PHASE 3 of 5 (Stripe path)** — Creates Stripe products, prices, payment links, webhook, and portal.
> Runs in two sub-phases: **3A (TEST mode)** and optionally **3B (LIVE mode)**.
> 3A is always required first. 3B runs after E2E test verification passes.
> Every Stripe object is created, then immediately verified with a fetch call.

---

## Prerequisites (verify before starting)

Read `.env` → confirm:
- `PAYCRAFT_PROVIDER` = "stripe"
- `PAYCRAFT_MODE` = "test" or "live"
- `PAYCRAFT_PLAN_COUNT` is a number ≥ 1
- `PAYCRAFT_CURRENCY` is non-empty
- `PAYCRAFT_APP_REDIRECT_URL` is non-empty
- IF `PAYCRAFT_MODE` = "test": `PAYCRAFT_STRIPE_TEST_SECRET_KEY` starts with "sk_test_"
- IF `PAYCRAFT_MODE` = "live": `PAYCRAFT_STRIPE_LIVE_SECRET_KEY` starts with "sk_live_"

IF running in live mode AND test mode was NEVER completed:
  HARD STOP: "Complete Phase 3A (test mode) and Phase 5 E2E verification first.
              Then re-run with PAYCRAFT_MODE=live."

---

## Phase 3A — TEST Mode Setup

> Run this first. Uses sk_test_ key. Creates buy.stripe.com/test/ links. No real charges.

---

## Phase 3 Steps

### STEP 3A.1 — Verify Stripe MCP is available and in TEST MODE

```
PRE-CHECK: Verify Stripe MCP is configured in this Claude Code session.
  ACTION  : mcp__stripe__get_stripe_account_info
  IF CALL FAILS WITH "tool not found" OR "MCP not available":
    HARD STOP: "Stripe MCP is not connected in this Claude Code session.
                To enable it:
                1. Open Claude Code settings (Ctrl/Cmd+,)
                2. Go to 'MCP Servers'
                3. Add Stripe MCP with your PAYCRAFT_STRIPE_TEST_SECRET_KEY
                   OR set STRIPE_API_KEY env var and restart Claude Code.
                Alternative: Use /paycraft-adopt-stripe with manual mode (no MCP)
                  by running Stripe CLI commands directly."
  IF CALL RETURNS AUTH ERROR (401/403):
    HARD STOP: "Stripe MCP authentication failed.
                Check that PAYCRAFT_STRIPE_TEST_SECRET_KEY in .env matches the key
                configured in your Stripe MCP server settings."

VERIFY  : Response contains account id (starts with "acct_")
VERIFY  : livemode = false
IF livemode = true:
  HARD STOP: "Stripe MCP is connected to LIVE mode.
              PAYCRAFT_STRIPE_TEST_SECRET_KEY must be sk_test_... for Phase 3A.
              Update the key in .env and MCP settings, then re-run."
OUTPUT  : "✓ Stripe MCP available and connected (TEST MODE) — account: [acct_id]"
```

### STEP 3A.2 — Create test Product (idempotent)

```
DEDUP CHECK (run before creating — prevents duplicate products on re-run):
  ACTION  : mcp__stripe__list_products
  SEARCH  : any product with metadata.paycraft_adopt = "true"
  IF FOUND:
    DISPLAY: "Existing PayCraft test product found: [product.name] ([product.id])"
             "Re-use it? [Y] Yes (skip creation) / [N] Create a new one"
    IF [Y]:
      CAPTURE : product.id
      WRITE   : PAYCRAFT_STRIPE_TEST_PRODUCT_ID=[id] to .env
      OUTPUT  : "✓ Re-using existing test product: [product_id]"
      → SKIP to STEP 3.3
    IF [N]: proceed to creation below

READ    : PAYCRAFT_PLAN_1_NAME from .env (for product naming context)

ACTION  : mcp__stripe__create_product
          name: "PayCraft Billing (TEST)"
          description: "PayCraft test product — created by /paycraft-adopt"
          metadata: {paycraft_test: "true", paycraft_adopt: "true"}

VERIFY  : mcp__stripe__list_products
          → product with metadata.paycraft_adopt = "true" exists
          → product.active = true
CAPTURE : product.id → write PAYCRAFT_STRIPE_TEST_PRODUCT_ID=[id] to .env
VERIFY  : Re-read .env → PAYCRAFT_STRIPE_TEST_PRODUCT_ID non-empty
IF VERIFY FAILS:
  HARD STOP: "Product created but ID not written to .env."
OUTPUT  : "✓ Test product created: [product_id]"
```

### STEP 3A.3 — Create test Prices (one per plan)

```
READ    : PAYCRAFT_PLAN_COUNT, PAYCRAFT_STRIPE_TEST_PRODUCT_ID,
          PAYCRAFT_CURRENCY from .env

FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_PLAN_[i]_NAME, PAYCRAFT_PLAN_[i]_PRICE from .env

  DEDUP CHECK (run BEFORE creating — prevents duplicate prices on re-run):
    CHECK: Is PAYCRAFT_STRIPE_TEST_PRICE_[PLAN_ID] already set in .env AND non-empty?
    IF SET:
      ACTION  : mcp__stripe__fetch_stripe_resources
                resource: "price"
                id: [PAYCRAFT_STRIPE_TEST_PRICE_[PLAN_ID]]
      IF price.active = true AND price.unit_amount = [PAYCRAFT_PLAN_[i]_PRICE]:
        OUTPUT: "  ✓ Price for [plan_name] already exists ([price_id]) — skipping creation"
        → CONTINUE to next plan
      IF FETCH FAILS OR price.active = false:
        NOTE: "Stored price ID [id] is invalid — creating a new price"
        → PROCEED to create below

  DETERMINE recurring interval — read PAYCRAFT_PLAN_[i]_INTERVAL from .env:
    READ: PAYCRAFT_PLAN_[i]_INTERVAL (e.g. "/month", "/year", "/3 months", "monthly")
    MAP:
      contains "month" AND NOT contains "3" → interval=month, interval_count=1
      contains "3" AND contains "month"     → interval=month, interval_count=3
      contains "quarter"                    → interval=month, interval_count=3
      contains "year"                       → interval=year,  interval_count=1
      else → ask user: "How often is [plan_id] billed?
                        [1] Monthly (every month)
                        [2] Quarterly (every 3 months)
                        [3] Yearly (every year)"

  ACTION  : mcp__stripe__create_price
            product: [PAYCRAFT_STRIPE_TEST_PRODUCT_ID]
            unit_amount: [PAYCRAFT_PLAN_[i]_PRICE]
            currency: [PAYCRAFT_CURRENCY]
            recurring.interval: [month/year]
            recurring.interval_count: [1/3]
            nickname: "[PAYCRAFT_PLAN_[i]_ID] test"
            metadata: {paycraft_plan: "[plan_id]", paycraft_test: "true"}

  VERIFY  : mcp__stripe__list_prices
            → price with nickname "[plan_id] test" exists
            → price.active = true
            → price.unit_amount = [PAYCRAFT_PLAN_[i]_PRICE]
  IF NOT FOUND OR AMOUNT MISMATCH:
    HARD STOP: "Price for plan [plan_id] not verified.
                Expected amount: [amount], currency: [currency]"
  CAPTURE : price.id → write PAYCRAFT_STRIPE_TEST_PRICE_[PLAN_ID]=[price_id] to .env
  OUTPUT  : "  ✓ Price for [plan_name]: [currency][amount/100] ([price_id])"

OUTPUT : "✓ [N] test prices created"
```

### STEP 3A.4 — Create test Payment Links (one per plan)

```
FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_STRIPE_TEST_PRICE_[PLAN_ID] from .env

  ACTION  : mcp__stripe__create_payment_link
            line_items: [{price: [price_id], quantity: 1}]
            metadata: {paycraft_plan: "[plan_id]", paycraft_test: "true"}
            after_completion.type: redirect
            after_completion.redirect.url: [PAYCRAFT_APP_REDIRECT_URL]

  IF ERROR "not supported while using Accounts V2":
    NOTE: Stripe Accounts V2 does not support test payment links — Sandboxes are required.
    DISPLAY: "Accounts V2 detected — you'll need to create test payment links manually in the Stripe Dashboard."
    USER ACTION GATE:
      "1. Open: https://dashboard.stripe.com/test/payment-links  (ensure Test mode is ON)"
      "2. Create one payment link per plan"
      "3. Paste each URL here (one per line)"
    COLLECT and WRITE PAYCRAFT_STRIPE_TEST_LINK_[PLAN_ID]=[url] to .env for each plan
    → SKIP URL validation below

  VERIFY (standard path): link.url starts with "https://buy.stripe.com/test/" OR "https://buy.stripe.com/"
  IF NOT:
    HARD STOP: "Invalid payment link URL: [url]. Must start with https://buy.stripe.com/"
  CAPTURE : link.url → write PAYCRAFT_STRIPE_TEST_LINK_[PLAN_ID]=[url] to .env
  OUTPUT  : "  ✓ Test payment link [plan_id]: [url]"

VERIFY (final): Re-read .env → all PAYCRAFT_STRIPE_TEST_LINK_* keys for configured plans are non-empty
IF ANY EMPTY:
  HARD STOP: "Not all test payment link URLs were written to .env."
OUTPUT : "✓ [N] test payment links created and saved to .env (PAYCRAFT_STRIPE_TEST_LINK_*)"
```

### STEP 3A.5 — Create Stripe TEST Webhook endpoint (USER ACTION GATE)

```
USER ACTION GATE:
  DISPLAY:
    "Now create the webhook endpoint in Stripe Dashboard."
    "Follow these steps EXACTLY:"
    ""
    "1. Open: https://dashboard.stripe.com/test/webhooks"
    "   (Confirm you're in TEST mode — check toggle in top-right)"
    ""
    "2. Click the button: '+ Add endpoint' or '+ Add destination'"
    ""
    "3. In 'Endpoint URL', enter:"
    "   [PAYCRAFT_SUPABASE_URL]/functions/v1/stripe-webhook"
    "   (Copy this exactly — replacing [PAYCRAFT_SUPABASE_URL] with your value)"
    ""
    "4. Under 'Select events to listen to', add these 4 events:"
    "   ✓ checkout.session.completed"
    "   ✓ customer.subscription.updated"
    "   ✓ customer.subscription.deleted"
    "   ✓ invoice.paid"
    "   (Search for each by name, click to select)"
    ""
    "5. Click 'Add endpoint' to save"
    ""
    "6. You'll land on the endpoint detail page."
    "   Under 'Signing secret', click 'Reveal'"
    "   Copy the full signing secret (starts with whsec_...)"
    ""
    "7. Paste the signing secret here:"

WAIT: user pastes webhook secret
VALIDATE: value starts with "whsec_"
IF NOT:
  HARD STOP: "Invalid webhook secret format. Must start with 'whsec_'.
              Go back to Stripe → Webhooks → your endpoint → 'Reveal' signing secret."

STEP A — Write to .env:
ACTION  : Write PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET=[value] to .env
VERIFY  : Re-read .env → PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET starts with "whsec_"
IF VERIFY FAILS:
  HARD STOP: "Failed to write webhook secret to .env. Check file permissions."

STEP B — Write to Supabase (with rollback on failure):
ACTION  : supabase secrets set STRIPE_WEBHOOK_SECRET=[value]
            --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
VERIFY  : supabase secrets list --project-ref [ref] | grep STRIPE_WEBHOOK_SECRET
IF NOT FOUND:
  DISPLAY: "⚠️  Supabase secret set failed — .env was already updated."
  HARD STOP: "STRIPE_WEBHOOK_SECRET not set on Supabase function.
              Your .env has the correct value.
              To retry only the Supabase step:
                supabase secrets set STRIPE_WEBHOOK_SECRET=[value from .env]
                  --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
              Then re-run Step 3.5."

OUTPUT  : "✓ TEST webhook signing secret: set in .env (PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET) + Supabase function secrets"
```

### STEP 3A.6 — Verify TEST webhook endpoint is correctly configured (MANDATORY)

```
DISPLAY : "Verifying Stripe webhook endpoint has all required events subscribed..."

ACTION  : mcp__stripe__fetch_stripe_resources resource=webhook_endpoints
VERIFY  : A webhook endpoint exists with url containing "stripe-webhook"
IF NO MATCHING ENDPOINT:
  HARD STOP: "No Stripe webhook endpoint found with 'stripe-webhook' in the URL.
              Did you complete Step 3.5?
              Open https://dashboard.stripe.com/test/webhooks and check your endpoint."

CAPTURE : The matching endpoint object
VERIFY  : endpoint.status = "enabled"
IF NOT ENABLED:
  HARD STOP: "Webhook endpoint status is '[status]' — must be 'enabled'.
              Open https://dashboard.stripe.com/test/webhooks → your endpoint → Enable it."

VERIFY  : endpoint.enabled_events includes ALL 4 of:
            "checkout.session.completed"
            "customer.subscription.updated"
            "customer.subscription.deleted"
            "invoice.paid"

MISSING_EVENTS = [list of events NOT in enabled_events]
IF MISSING_EVENTS is non-empty:
  HARD STOP: "Webhook endpoint is missing required events: [MISSING_EVENTS]
              Fix:
              1. Open: https://dashboard.stripe.com/test/webhooks
              2. Click your endpoint
              3. Click 'Edit'
              4. Search for and add each missing event
              5. Click 'Update endpoint'
              Then re-run this step."

OUTPUT  : "✓ Webhook endpoint verified:"
         "  URL: [endpoint.url]"
         "  Status: enabled"
         "  Events: checkout.session.completed ✓ | customer.subscription.updated ✓"
         "          customer.subscription.deleted ✓ | invoice.paid ✓"
```

### STEP 3A.7 — Enable Stripe TEST Customer Portal (USER ACTION GATE)

```
USER ACTION GATE:
  DISPLAY:
    "Enable the Stripe Customer Portal (lets subscribers manage their plan):"
    ""
    "1. Open: https://dashboard.stripe.com/test/settings/billing/portal"
    ""
    "2. Toggle the portal to ACTIVE (if not already)"
    ""
    "3. Under 'Business information':"
    "   - Set your app/business name"
    "   - Set support email (use [PAYCRAFT_SUPPORT_EMAIL])"
    ""
    "4. Under 'Customer portal features':"
    "   ✓ Enable 'Cancel subscriptions'"
    "   ✓ Enable 'Update subscriptions' (optional)"
    ""
    "5. Click 'Save changes'"
    ""
    "5b. Under 'Return URL' (Business information section):"
    "    ⚠️  Stripe REQUIRES https:// — deep links (myapp://) are NOT accepted here."
    "    BEST: Use a web redirect page that bounces back to the app:"
    "      https://yoursite.com/app?source=billing-portal"
    "      (That page does: window.location = 'myapp://paycraft/portal/return';"
    "       with a Play Store / App Store fallback after 2s)"
    "    SIMPLE (works now): Use your website homepage, e.g. https://yoursite.com"
    "    (Users land on your site — update to a redirect page later for better UX)"
    ""
    "6. Click 'Save changes'"
    ""
    "7. Copy the portal link from the 'Portal link' section at the top of the page"
    "   (starts with https://billing.stripe.com/p/login/...)"
    ""
    "8. Paste the portal URL here:"

WAIT: user pastes portal URL
VALIDATE: starts with "https://billing.stripe.com"
IF NOT:
  HARD STOP: "Invalid portal URL. Must start with https://billing.stripe.com.
              Copy the link from: https://dashboard.stripe.com/test/settings/billing/portal"

ACTION  : Write PAYCRAFT_STRIPE_TEST_PORTAL_URL=[url] to .env
VERIFY  : Re-read .env → PAYCRAFT_STRIPE_TEST_PORTAL_URL starts with "https://billing.stripe.com"
OUTPUT  : "✓ TEST customer portal URL saved (PAYCRAFT_STRIPE_TEST_PORTAL_URL)"
```

---

## Phase 3A Checkpoint

```
╔══ PHASE 3A COMPLETE — Stripe Setup (TEST MODE) ════════════════════╗
║                                                                      ║
║  ✓ Stripe connected — TEST MODE (livemode=false)                   ║
║  ✓ Test product: [product_id] → PAYCRAFT_STRIPE_TEST_PRODUCT_ID    ║
║  ✓ Test prices ([N] plans):                                         ║
║    [list: plan_id → price_id → PAYCRAFT_STRIPE_TEST_PRICE_[PLAN]]  ║
║  ✓ Test payment links ([N] links):                                  ║
║    [list: plan_id → PAYCRAFT_STRIPE_TEST_LINK_[PLAN] = url]        ║
║  ✓ Test webhook secret: PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET set    ║
║  ✓ Test portal URL: PAYCRAFT_STRIPE_TEST_PORTAL_URL set            ║
║                                                                      ║
║  All TEST keys written with PAYCRAFT_STRIPE_TEST_ prefix.           ║
║  No real money will be charged.                                      ║
║                                                                      ║
║  Ready to proceed to Phase 4: Client Integration?                   ║
║  [Y] Continue to Phase 4   [L] Set up LIVE mode now   [Q] Quit     ║
╚══════════════════════════════════════════════════════════════════════╝
```

Wait for user selection:
- `[Y]`: proceed to Phase 4 (recommended — verify test mode first)
- `[L]`: run Phase 3B (LIVE mode setup) before Phase 4
- `[Q]`: quit

---

## Phase 3B — LIVE Mode Setup

> Run this ONLY after Phase 5 E2E verification passes in test mode.
> Uses sk_live_ key. Creates real buy.stripe.com/ links. Real charges apply.

### Prerequisites for Phase 3B

```
READ: PAYCRAFT_STRIPE_LIVE_SECRET_KEY from .env
IF EMPTY OR NOT starts with "sk_live_":
  HARD STOP: "PAYCRAFT_STRIPE_LIVE_SECRET_KEY is missing or not a live key.
              Get it from: https://dashboard.stripe.com/apikeys  (Test mode OFF)
              Add it to .env as PAYCRAFT_STRIPE_LIVE_SECRET_KEY=sk_live_...
              Then re-run."

DISPLAY:
  "⚠️  LIVE MODE — This will create REAL Stripe resources."
  "   Real payment links will charge real money."
  "   Only proceed after Phase 5 test mode verification passed."
  ""
  "Continue with LIVE mode setup? [Y] Yes / [Q] Cancel"
WAIT: user [Y] or [Q]
IF [Q]: STOP
```

### STEP 3B.1 — Verify Stripe MCP in LIVE mode

```
NOTE: Reconfigure your Stripe MCP with PAYCRAFT_STRIPE_LIVE_SECRET_KEY before this step.
      The MCP must be connected with the sk_live_ key for live resources.

ACTION  : mcp__stripe__get_stripe_account_info
VERIFY  : livemode = true
IF livemode = false:
  HARD STOP: "Stripe MCP is still in TEST mode.
              Update MCP configuration with PAYCRAFT_STRIPE_LIVE_SECRET_KEY (sk_live_...)
              and restart Claude Code, then re-run."
OUTPUT  : "✓ Stripe MCP connected — LIVE MODE — account: [acct_id]"
```

### STEP 3B.2 — Create LIVE Product (idempotent)

```
DEDUP CHECK:
  ACTION  : mcp__stripe__list_products
  SEARCH  : product with metadata.paycraft_adopt = "true" AND metadata.paycraft_live = "true"
  IF FOUND:
    DISPLAY: "Existing PayCraft live product found: [product.name] ([product.id])"
             "Re-use it? [Y] Yes / [N] Create a new one"
    IF [Y]:
      WRITE: PAYCRAFT_STRIPE_LIVE_PRODUCT_ID=[id] to .env
      OUTPUT: "✓ Re-using existing live product: [product_id]"
      → SKIP to STEP 3B.3

ACTION  : mcp__stripe__create_product
          name: "[PAYCRAFT_PLAN_1_NAME] Premium"  (use real app/plan name)
          description: "PayCraft live product — [support_email]"
          metadata: {paycraft_live: "true", paycraft_adopt: "true"}

VERIFY  : mcp__stripe__list_products → product exists AND active = true
CAPTURE : product.id → write PAYCRAFT_STRIPE_LIVE_PRODUCT_ID=[id] to .env
OUTPUT  : "✓ LIVE product created: [product_id]"
```

### STEP 3B.3 — Create LIVE Prices (one per plan)

```
READ    : PAYCRAFT_PLAN_COUNT, PAYCRAFT_STRIPE_LIVE_PRODUCT_ID, PAYCRAFT_CURRENCY from .env

FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_PLAN_[i]_NAME, PAYCRAFT_PLAN_[i]_PRICE from .env

  DEDUP CHECK:
    IF PAYCRAFT_STRIPE_LIVE_PRICE_[PLAN_ID] already set → verify active → skip if OK

  DETERMINE recurring interval (same logic as Phase 3A.3)

  ACTION  : mcp__stripe__create_price
            product: [PAYCRAFT_STRIPE_LIVE_PRODUCT_ID]
            unit_amount: [PAYCRAFT_PLAN_[i]_PRICE]
            currency: [PAYCRAFT_CURRENCY]
            recurring.interval: [month/year]
            recurring.interval_count: [1/3]
            nickname: "[PAYCRAFT_PLAN_[i]_ID] live"
            metadata: {paycraft_plan: "[plan_id]", paycraft_live: "true"}

  VERIFY  : price active AND unit_amount correct
  CAPTURE : price.id → write PAYCRAFT_STRIPE_LIVE_PRICE_[PLAN_ID]=[price_id] to .env
  OUTPUT  : "  ✓ LIVE price for [plan_name]: [currency][amount/100] ([price_id])"

OUTPUT : "✓ [N] live prices created"
```

### STEP 3B.4 — Create LIVE Payment Links (one per plan)

```
FOR EACH PLAN i = 1..PAYCRAFT_PLAN_COUNT:
  READ: PAYCRAFT_PLAN_[i]_ID, PAYCRAFT_STRIPE_LIVE_PRICE_[PLAN_ID] from .env

  ACTION  : mcp__stripe__create_payment_link
            line_items: [{price: [price_id], quantity: 1}]
            metadata: {paycraft_plan: "[plan_id]", paycraft_live: "true"}
            after_completion.type: redirect
            after_completion.redirect.url: [PAYCRAFT_APP_REDIRECT_URL]

  VERIFY  : link.url starts with "https://buy.stripe.com/"
  IF link.url starts with "https://buy.stripe.com/test/":
    HARD STOP: "Created a test link while in live mode.
                Verify Stripe MCP is using sk_live_ key and livemode=true."
  CAPTURE : link.url → write PAYCRAFT_STRIPE_LIVE_LINK_[PLAN_ID]=[url] to .env
  OUTPUT  : "  ✓ LIVE payment link [plan_id]: [url]"

VERIFY (final): all PAYCRAFT_STRIPE_LIVE_LINK_* keys non-empty
OUTPUT : "✓ [N] live payment links saved to .env (PAYCRAFT_STRIPE_LIVE_LINK_*)"
```

### STEP 3B.5 — Create LIVE Webhook endpoint (USER ACTION GATE)

```
USER ACTION GATE:
  DISPLAY:
    "Create the LIVE webhook endpoint in Stripe Dashboard:"
    ""
    "1. Open: https://dashboard.stripe.com/webhooks"
    "   (Confirm you're in LIVE mode — toggle should be OFF)"
    ""
    "2. Click '+ Add endpoint'"
    ""
    "3. Endpoint URL:"
    "   [PAYCRAFT_SUPABASE_URL]/functions/v1/stripe-webhook"
    ""
    "4. Select events (same 4 as test):"
    "   ✓ checkout.session.completed"
    "   ✓ customer.subscription.updated"
    "   ✓ customer.subscription.deleted"
    "   ✓ invoice.paid"
    ""
    "5. Click 'Add endpoint'"
    ""
    "6. Reveal signing secret (starts with whsec_)"
    "   Paste here:"

WAIT: user pastes
VALIDATE: starts with "whsec_"
WRITE: PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET=[value] to .env
VERIFY: Re-read → starts with "whsec_"

ACTION: supabase secrets set STRIPE_WEBHOOK_SECRET=[value]
          --project-ref [PAYCRAFT_SUPABASE_PROJECT_REF]
VERIFY: supabase secrets list | grep STRIPE_WEBHOOK_SECRET
OUTPUT: "✓ LIVE webhook secret: PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET set in .env + Supabase"
```

### STEP 3B.6 — Enable LIVE Customer Portal (USER ACTION GATE)

```
USER ACTION GATE:
  DISPLAY:
    "Enable the LIVE Stripe Customer Portal:"
    ""
    "1. Open: https://dashboard.stripe.com/settings/billing/portal"
    "   (Live mode — toggle OFF)"
    ""
    "2. Toggle portal to ACTIVE"
    ""
    "3. Set business name + support email: [PAYCRAFT_SUPPORT_EMAIL]"
    ""
    "4. Enable 'Cancel subscriptions'"
    ""
    "5. Set Return URL (must be https:// — use your website or a redirect page)"
    ""
    "6. Save and copy portal URL (starts with https://billing.stripe.com/p/login/...)"
    "   Paste here:"

WAIT: user pastes
VALIDATE: starts with "https://billing.stripe.com"
WRITE: PAYCRAFT_STRIPE_LIVE_PORTAL_URL=[url] to .env
VERIFY: Re-read → starts with "https://billing.stripe.com"
OUTPUT: "✓ LIVE portal URL saved (PAYCRAFT_STRIPE_LIVE_PORTAL_URL)"
```

---

## Phase 3B Checkpoint

```
╔══ PHASE 3B COMPLETE — Stripe Setup (LIVE MODE) ════════════════════╗
║                                                                      ║
║  ✓ Stripe connected — LIVE MODE (livemode=true)                    ║
║  ✓ Live product: [product_id] → PAYCRAFT_STRIPE_LIVE_PRODUCT_ID   ║
║  ✓ Live prices ([N] plans):                                         ║
║    [list: plan_id → price_id → PAYCRAFT_STRIPE_LIVE_PRICE_[PLAN]]  ║
║  ✓ Live payment links ([N] links):                                  ║
║    [list: plan_id → PAYCRAFT_STRIPE_LIVE_LINK_[PLAN] = url]        ║
║  ✓ Live webhook secret: PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET set    ║
║  ✓ Live portal URL: PAYCRAFT_STRIPE_LIVE_PORTAL_URL set            ║
║                                                                      ║
║  ⚠️  Update your app's initPayCraft() to use LIVE payment links    ║
║      and portal URL before releasing to production.                  ║
║                                                                      ║
║  KEY HANDOFF — paste these into initPayCraft():                     ║
║    Monthly link : [PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY]              ║
║    Yearly link  : [PAYCRAFT_STRIPE_LIVE_LINK_YEARLY]               ║
║    Portal URL   : [PAYCRAFT_STRIPE_LIVE_PORTAL_URL]                ║
║                                                                      ║
║  Ready to proceed to Phase 4: Client Integration?                   ║
║  [Y] Continue   [Q] Quit                                            ║
╚══════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding.
