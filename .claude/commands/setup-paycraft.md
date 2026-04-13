# /setup-paycraft — Single Source of Truth

> Complete PayCraft integration in one command.
> Everything automated. Zero manual steps skipped.

---

## ENFORCEMENT MATRIX

Run this at the start. Print it. Never proceed to a step without the previous one marked ✅.

```
╔══════╦══════════════════════════════════╦═══════════════════════╦════════╗
║ Step ║ What                             ║ Method                ║ Status ║
╠══════╬══════════════════════════════════╬═══════════════════════╬════════╣
║  0   ║ .env setup (secrets)             ║ Claude Intelligence   ║ [ ]    ║
║  1   ║ Supabase — table + RPCs          ║ API or Supabase MCP   ║ [ ]    ║
║  2   ║ Supabase — deploy webhook        ║ CLI or API            ║ [ ]    ║
║  3   ║ Payment provider setup           ║ Stripe MCP or API     ║ [ ]    ║
║  4   ║ Generate PayCraft.configure()    ║ Claude Intelligence   ║ [ ]    ║
║  5   ║ App integration code             ║ Claude Intelligence   ║ [ ]    ║
║  6   ║ Verify end-to-end                ║ /verify child cmd     ║ [ ]    ║
╚══════╩══════════════════════════════════╩═══════════════════════╩════════╝
```

**Block rules:**
- Step N+1 NEVER starts until Step N = ✅
- Any API call failure = stop + show fix + ask [Retry / Skip / Abort]
- If MCP unavailable, automatically fall back to REST API (never silent fail)

---

## MCP DETECTION

Before doing anything, detect which MCPs are available:

```
╔══════════════════════╦═════════════════════════════════════╦════════════╗
║ MCP                  ║ Used for                            ║ Detected   ║
╠══════════════════════╬═════════════════════════════════════╬════════════╣
║ mcp__stripe__*       ║ Create products, prices, links      ║ auto-check ║
║ Supabase MCP         ║ Apply migrations, query tables      ║ auto-check ║
╚══════════════════════╩═════════════════════════════════════╩════════════╝
```

**Detection logic:**
- Try calling `mcp__stripe__get_stripe_account_info` — if it succeeds → Stripe MCP ✅
- Try calling a Supabase MCP tool — if it succeeds → Supabase MCP ✅
- For any MCP that's missing → use REST API path (documented per step below)

**To configure Stripe MCP** (for full automation):
```json
// .claude/settings.json
{
  "mcpServers": {
    "stripe": {
      "command": "npx",
      "args": ["-y", "@stripe/mcp", "--api-key", "YOUR_STRIPE_SECRET_KEY"]
    }
  }
}
```

---

## STEP 0 — .env Setup

### 0a: Check if .env exists

```bash
test -f .env && echo "EXISTS" || echo "MISSING"
```

**If MISSING:** Copy from template:
```bash
cp .env.example .env
```

Then tell the user:
> "I've created `.env` from the template. I need the following values.
>  You can find them at the URLs shown — paste each one and I'll save it."

### 0b: Collect required values

Ask for each value one group at a time. Use this exact naming (PAYCRAFT_ prefix always):

**Group 1 — Supabase:**
```
PAYCRAFT_SUPABASE_URL          → https://supabase.com/dashboard/project/<ref>/settings/api
PAYCRAFT_SUPABASE_PROJECT_REF  → just the <ref> slug from your project URL
PAYCRAFT_SUPABASE_ANON_KEY     → Settings → API → anon key
PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY → Settings → API → service_role key  ⚠️ keep secret
PAYCRAFT_SUPABASE_ACCESS_TOKEN → https://supabase.com/dashboard/account/tokens → Generate new
```

**Group 2 — Provider (ask which provider first):**

*Stripe:*
```
PAYCRAFT_STRIPE_SECRET_KEY     → https://dashboard.stripe.com/apikeys → Secret key
```

*Razorpay:*
```
PAYCRAFT_RAZORPAY_KEY_ID       → https://dashboard.razorpay.com/app/keys
PAYCRAFT_RAZORPAY_KEY_SECRET   → same page → Key Secret
```

**Group 3 — App config:**
```
PAYCRAFT_SUPPORT_EMAIL         → your support email
PAYCRAFT_CURRENCY              → currency code: inr / usd / eur / gbp
PAYCRAFT_APP_REDIRECT_URL      → deep link or URL shown after payment
```

### 0c: Write to .env

After user provides each value, use Edit tool to set it in `.env`:
```
PAYCRAFT_SUPABASE_URL=https://abcxyz.supabase.co
```

Confirm after writing: "✅ Saved PAYCRAFT_SUPABASE_URL to .env"

**Never print secret key values back to the user.**

---

## STEP 1 — Supabase: Table + RPCs

### Path A — Supabase MCP (if available)

Use the Supabase MCP to execute each migration SQL directly.

Read `server/migrations/001_create_subscriptions.sql` and execute via MCP.
Read `server/migrations/002_create_rpcs.sql` and execute via MCP.

### Path B — REST API (fallback when MCP unavailable)

Read `.env` → use `PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY` and `PAYCRAFT_SUPABASE_PROJECT_REF`.

Execute each migration via Supabase Management API:

```bash
# Apply migration 001
SQL=$(cat server/migrations/001_create_subscriptions.sql)
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | jq -Rs .)}" | jq .

# Apply migration 002
SQL=$(cat server/migrations/002_create_rpcs.sql)
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | jq -Rs .)}" | jq .
```

**Verification after Step 1:**
```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT routine_name FROM information_schema.routines WHERE routine_name IN ('"'"'is_premium'"'"','"'"'get_subscription'"'"')"}' \
  | jq .
```

Expected: 2 rows returned (is_premium, get_subscription).

Mark ✅ Step 1 only when both RPCs confirmed.

---

## STEP 2 — Supabase: Deploy Webhook

Load `.env` values. Determine provider from earlier input.

### Path A — Supabase CLI (preferred)

```bash
# Login (if not already)
supabase login

# Deploy webhook
supabase functions deploy ${PROVIDER}-webhook \
  --project-ref ${PAYCRAFT_SUPABASE_PROJECT_REF} \
  --no-verify-jwt

# Set provider secrets
# For Stripe:
supabase secrets set \
  STRIPE_SECRET_KEY="${PAYCRAFT_STRIPE_SECRET_KEY}" \
  --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}"
```

### Path B — Management API (if CLI unavailable)

```bash
# Deploy via API
FUNCTION_BODY=$(cat "server/functions/${PROVIDER}-webhook/index.ts" | jq -Rs .)
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/functions" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"slug\":\"${PROVIDER}-webhook\",\"name\":\"${PROVIDER}-webhook\",\"body\":${FUNCTION_BODY},\"verify_jwt\":false}"
```

**After deploy:** Tell user:
> "Webhook deployed at: `https://${PAYCRAFT_SUPABASE_PROJECT_REF}.functions.supabase.co/${PROVIDER}-webhook`
>
> Next: register this URL in your ${PROVIDER} dashboard as a webhook endpoint."

Show step-by-step instructions per provider (see provider-specific section).

Mark ✅ Step 2 after webhook URL confirmed alive (HTTP 200 or 405 on GET is fine).

---

## STEP 3 — Payment Provider Setup

Run the appropriate child command:

| Provider | Child command |
|----------|--------------|
| Stripe | `/setup-stripe` |
| Razorpay | `/setup-razorpay` |

The child command will:
- Use Stripe MCP (if available) OR fall back to REST API
- Create products, prices, and payment links
- Return the payment link URLs
- Save them to `.env` as `PAYCRAFT_STRIPE_LINK_MONTHLY` etc.

After child command completes, save payment links to `.env`.

Mark ✅ Step 3 when payment links are in `.env`.

---

## STEP 4 — Generate PayCraft.configure()

Read all values from `.env`. Generate the complete configure block:

```kotlin
PayCraft.configure {
    supabase(
        url = BuildConfig.PAYCRAFT_SUPABASE_URL,
        anonKey = BuildConfig.PAYCRAFT_SUPABASE_ANON_KEY,
    )
    provider(
        StripeProvider(   // or RazorpayProvider
            paymentLinks = mapOf(
                "monthly"   to BuildConfig.PAYCRAFT_STRIPE_LINK_MONTHLY,
                "quarterly" to BuildConfig.PAYCRAFT_STRIPE_LINK_QUARTERLY,
                "yearly"    to BuildConfig.PAYCRAFT_STRIPE_LINK_YEARLY,
            ),
            customerPortalUrl = BuildConfig.PAYCRAFT_STRIPE_PORTAL_URL,
        )
    )
    plans(
        BillingPlan(id = "monthly",   name = "Monthly",   price = "...",  interval = "/month"),
        BillingPlan(id = "quarterly", name = "Quarterly", price = "...",  interval = "/3 months"),
        BillingPlan(id = "yearly",    name = "Yearly",    price = "...",  interval = "/year", isPopular = true),
    )
    benefits(
        BillingBenefit(icon = Icons.Default.Block,    text = "Ad-free experience"),
        BillingBenefit(icon = Icons.Default.Download, text = "Unlimited downloads"),
        BillingBenefit(icon = Icons.Default.Star,     text = "Premium features"),
    )
    supportEmail(BuildConfig.PAYCRAFT_SUPPORT_EMAIL)
}
```

Also output `local.properties` additions or `BuildConfig` fields needed:
```
PAYCRAFT_SUPABASE_URL=...
PAYCRAFT_SUPABASE_ANON_KEY=...
```

Mark ✅ Step 4 when configure block is shown to user.

---

## STEP 5 — App Integration

Tell user to add to their app's `build.gradle.kts`:
```kotlin
commonMain.dependencies {
    implementation("io.github.mobilebytelabs:paycraft:VERSION")
}
```

Show complete initialization snippet (Application class or shared entry point).

Show UI usage (PayCraftSheet, PayCraftBanner).

Mark ✅ Step 5 (informational).

---

## STEP 6 — Verify End-to-End

Run `/verify` child command.

The verify command checks:
- [ ] subscriptions table exists
- [ ] is_premium() RPC exists
- [ ] get_subscription() RPC exists
- [ ] RLS policies active
- [ ] Webhook function deployed and reachable
- [ ] Payment links are valid URLs
- [ ] .env has all required keys set

Mark ✅ Step 6 when all checks pass.

---

## FINAL OUTPUT

After all 7 steps pass:

```
╔═══════════════════════════════════════════════════════╗
║  ✅  PayCraft Setup Complete!                         ║
╠═══════════════════════════════════════════════════════╣
║  Step 0  ✅  .env configured                          ║
║  Step 1  ✅  Supabase table + RPCs                    ║
║  Step 2  ✅  Webhook deployed                         ║
║  Step 3  ✅  Payment links created                    ║
║  Step 4  ✅  PayCraft.configure() generated           ║
║  Step 5  ✅  Integration code shown                   ║
║  Step 6  ✅  End-to-end verified                      ║
╚═══════════════════════════════════════════════════════╝

Webhook URL:
  https://<ref>.functions.supabase.co/<provider>-webhook

Next steps:
  1. Register the webhook URL in your provider dashboard
  2. Copy PayCraft.configure() into your app (shown above)
  3. Add dependency: io.github.mobilebytelabs:paycraft:VERSION
  4. Start Koin with PayCraftModule

To re-verify anytime: /verify
To release the library: ./scripts/release.sh
```
