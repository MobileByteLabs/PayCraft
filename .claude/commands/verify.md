# /verify — Verify PayCraft Setup End-to-End

Checks that the entire PayCraft setup is working correctly.
Reads all credentials from `.env` — no interactive prompts.

## Prerequisite

`.env` must exist. If missing, run `/setup-paycraft` first.

## What It Checks

```
╔══════╦══════════════════════════════════════════╦════════╗
║  #   ║ Check                                    ║ Status ║
╠══════╬══════════════════════════════════════════╬════════╣
║  1   ║ .env — all required keys set             ║ [ ]    ║
║  2   ║ subscriptions table exists               ║ [ ]    ║
║  3   ║ RLS enabled on subscriptions             ║ [ ]    ║
║  4   ║ is_premium() RPC exists                  ║ [ ]    ║
║  5   ║ get_subscription() RPC exists            ║ [ ]    ║
║  6   ║ Email unique index exists                ║ [ ]    ║
║  7   ║ is_premium(test@example.com) executes    ║ [ ]    ║
║  8   ║ Webhook function deployed + reachable    ║ [ ]    ║
║  9   ║ Payment links are valid URLs             ║ [ ]    ║
╚══════╩══════════════════════════════════════════╩════════╝
```

## Steps

### Step 1: Load .env

```bash
# Check .env exists
test -f .env || { echo "❌ .env missing — run /setup-paycraft first"; exit 1; }
source .env
```

### Step 2: Verify required .env keys

Required keys (fail fast if any are blank):
- `PAYCRAFT_SUPABASE_URL`
- `PAYCRAFT_SUPABASE_PROJECT_REF`
- `PAYCRAFT_SUPABASE_ACCESS_TOKEN`
- `PAYCRAFT_SUPABASE_ANON_KEY`

For each, check: `[ -n "$KEY" ] || echo "❌ KEY is not set"`

### Step 3: Run verify script

```bash
chmod +x server/scripts/verify.sh
./server/scripts/verify.sh \
  --supabase-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}" \
  --token "${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  --email "verify-test@paycraft.dev"
```

The script checks all schema + function items listed in the matrix above.

### Step 4: Verify webhook reachable

```bash
# Determine provider from .env
if [ -n "${PAYCRAFT_STRIPE_SECRET_KEY}" ]; then PROVIDER="stripe"; else PROVIDER="razorpay"; fi

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${PAYCRAFT_SUPABASE_PROJECT_REF}.functions.supabase.co/${PROVIDER}-webhook")

[ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "405" ] \
  && echo "✅ Webhook live ($HTTP_STATUS)" \
  || echo "❌ Webhook not reachable (status: $HTTP_STATUS)"
```

### Step 5: Verify payment links

For each set link (`PAYCRAFT_STRIPE_LINK_MONTHLY` etc.):
```bash
[ -n "${PAYCRAFT_STRIPE_LINK_MONTHLY}" ] \
  && echo "✅ Monthly link: ${PAYCRAFT_STRIPE_LINK_MONTHLY}" \
  || echo "⚠️  Monthly link not set in .env"
```

## Output

```
PayCraft Verification Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

.env
  ✅ PAYCRAFT_SUPABASE_URL set
  ✅ PAYCRAFT_SUPABASE_PROJECT_REF set
  ✅ PAYCRAFT_SUPABASE_ACCESS_TOKEN set
  ✅ PAYCRAFT_SUPABASE_ANON_KEY set

Schema
  ✅ subscriptions table exists
  ✅ RLS enabled
  ✅ is_premium() RPC exists
  ✅ get_subscription() RPC exists
  ✅ Email unique index exists

Functions
  ✅ is_premium('verify-test@paycraft.dev') → false (correct)
  ✅ get_subscription('verify-test@paycraft.dev') → null (correct)

Edge Functions
  ✅ stripe-webhook deployed + reachable (HTTP 405)

Payment Links
  ✅ Monthly:   https://buy.stripe.com/...
  ✅ Quarterly: https://buy.stripe.com/...
  ✅ Yearly:    https://buy.stripe.com/...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ All 9 checks passed. PayCraft is ready!
```

## Fix Map

| Failed check | Fix command |
|---|---|
| Table missing | `/setup-supabase` |
| RPC missing | Apply `server/migrations/002_create_rpcs.sql` |
| Webhook missing | `/setup-supabase` Step 2 |
| Payment links missing | `/setup-stripe` or `/setup-razorpay` |
| .env key missing | Edit `.env` directly |
