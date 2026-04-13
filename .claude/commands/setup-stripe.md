# /setup-stripe — Stripe Products + Payment Links

Child command called by `/setup-paycraft` Step 3. Creates Stripe products, prices, and payment links.

## Prerequisites

`.env` must exist with `PAYCRAFT_STRIPE_SECRET_KEY` set.
Plans must be defined (from Step 0 of `/setup-paycraft`).

## MCP Detection

**Check first:**
```
Try: mcp__stripe__get_stripe_account_info
```
- If succeeds → use **Path A (MCP)** — fully automated
- If fails → use **Path B (REST API)** — automated via curl

Never ask the user to choose. Auto-detect and proceed.

---

## Path A — Stripe MCP (preferred)

### Step A1: Verify Stripe account

```
mcp__stripe__get_stripe_account_info
```

Show: account name, mode (live/test), country.

### Step A2: Create product for each plan

For each plan (monthly, quarterly, yearly):

```
mcp__stripe__create_product
  name: "PayCraft [Plan Name]"
  description: "PayCraft subscription — [interval]"
```

Save product IDs.

### Step A3: Create price for each product

```
mcp__stripe__create_price
  product: <product_id>
  unit_amount: <price in smallest currency unit>
  currency: <PAYCRAFT_CURRENCY from .env>
  recurring[interval]: month (monthly/quarterly) | year (yearly)
  recurring[interval_count]: 1 (monthly) | 3 (quarterly) | 1 (yearly)
```

Save price IDs.

### Step A4: Create payment link for each price

```
mcp__stripe__create_payment_link
  line_items[0][price]: <price_id>
  line_items[0][quantity]: 1
  after_completion[type]: redirect
  after_completion[redirect][url]: <PAYCRAFT_APP_REDIRECT_URL from .env>
```

Save payment link URLs.

---

## Path B — REST API (fallback)

Read `PAYCRAFT_STRIPE_SECRET_KEY` from `.env`.

### Step B1: Create product

```bash
curl -s -X POST https://api.stripe.com/v1/products \
  -u "${PAYCRAFT_STRIPE_SECRET_KEY}:" \
  -d "name=PayCraft Monthly" \
  -d "description=PayCraft subscription — /month"
```

Extract `id` → MONTHLY_PRODUCT_ID. Repeat for quarterly, yearly.

### Step B2: Create price

```bash
curl -s -X POST https://api.stripe.com/v1/prices \
  -u "${PAYCRAFT_STRIPE_SECRET_KEY}:" \
  -d "product=${MONTHLY_PRODUCT_ID}" \
  -d "unit_amount=9900" \
  -d "currency=${PAYCRAFT_CURRENCY}" \
  -d "recurring[interval]=month" \
  -d "recurring[interval_count]=1"
```

Extract `id` → MONTHLY_PRICE_ID. Repeat for quarterly (interval_count=3), yearly (interval=year).

### Step B3: Create payment link

```bash
curl -s -X POST https://api.stripe.com/v1/payment_links \
  -u "${PAYCRAFT_STRIPE_SECRET_KEY}:" \
  -d "line_items[0][price]=${MONTHLY_PRICE_ID}" \
  -d "line_items[0][quantity]=1" \
  -d "after_completion[type]=redirect" \
  -d "after_completion[redirect][url]=${PAYCRAFT_APP_REDIRECT_URL}"
```

Extract `url` → MONTHLY_PAYMENT_LINK. Repeat for quarterly, yearly.

---

## After either path: Save to .env

Use Edit tool to update `.env`:

```
PAYCRAFT_STRIPE_LINK_MONTHLY=https://buy.stripe.com/...
PAYCRAFT_STRIPE_LINK_QUARTERLY=https://buy.stripe.com/...
PAYCRAFT_STRIPE_LINK_YEARLY=https://buy.stripe.com/...
```

## Customer Portal

Instruct user:
> Enable at: https://dashboard.stripe.com/settings/billing/portal
> Then copy the portal URL and add to `.env`:
> `PAYCRAFT_STRIPE_PORTAL_URL=https://billing.stripe.com/p/login/...`

## Webhook Registration

Output:
> Register webhook in Stripe Dashboard:
> URL: `https://${PAYCRAFT_SUPABASE_PROJECT_REF}.functions.supabase.co/stripe-webhook`
>
> Events to select:
> - checkout.session.completed
> - customer.subscription.updated
> - customer.subscription.deleted
> - invoice.payment_failed
>
> After creating, copy the Signing Secret (whsec_...) and add to `.env`:
> `PAYCRAFT_STRIPE_WEBHOOK_SECRET=whsec_...`
>
> Then set it in Supabase:
> `supabase secrets set STRIPE_WEBHOOK_SECRET="${PAYCRAFT_STRIPE_WEBHOOK_SECRET}" --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}"`

## Output

```
✅ Stripe setup complete
   Monthly link:   https://buy.stripe.com/...
   Quarterly link: https://buy.stripe.com/...
   Yearly link:    https://buy.stripe.com/...
   Portal URL:     (pending — user must enable in Dashboard)
   Webhook:        Register at https://dashboard.stripe.com/webhooks
```
