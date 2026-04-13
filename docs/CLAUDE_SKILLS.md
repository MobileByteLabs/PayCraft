# PayCraft Claude AI Skills

PayCraft ships with Claude AI skills that automate the entire setup and integration process.

## Library Skills (for this repo)

Open Claude Code in the PayCraft directory and use:

| Skill | Command | What It Does |
|-------|---------|-------------|
| Full Setup | `/setup` | End-to-end: Supabase + provider + webhook + verify |
| Stripe Setup | `/setup-stripe` | Creates Stripe products, prices, payment links via Stripe MCP |
| Razorpay Setup | `/setup-razorpay` | Creates Razorpay payment links |
| Supabase Setup | `/setup-supabase` | Applies migrations, deploys webhook, sets secrets |
| Add Provider | `/add-provider` | Guides adding a new payment provider |
| Add Plan | `/add-plan` | Adds a new subscription plan |
| Verify | `/verify` | End-to-end verification of setup |
| Stats | `/status` | Shows subscription statistics |

## Client Skills (for your app)

Copy these files to your app's `.claude/commands/` directory:
- `client-skills/paycraft-setup.md` → `.claude/commands/paycraft-setup.md`
- `client-skills/paycraft-verify.md` → `.claude/commands/paycraft-verify.md`

Then in your app:

| Skill | Command | What It Does |
|-------|---------|-------------|
| Integrate | `/paycraft-setup` | Full PayCraft integration into any KMP app |
| Verify | `/paycraft-verify` | Verifies correct integration |

## MCP Requirements

For full automation, configure these MCP servers:

### Stripe MCP (for `/setup-stripe`)

Provides `mcp__stripe__*` tools for creating products, prices, and payment links automatically.

Configure in `.claude/settings.json`:
```json
{
  "mcpServers": {
    "stripe": {
      "command": "npx",
      "args": ["-y", "@stripe/mcp", "--api-key", "sk_live_YOUR_KEY"]
    }
  }
}
```

### Supabase MCP (optional, for `/status`)

Provides direct database access for querying subscription stats.

## How `/setup` Works (End-to-End)

```
/setup
  │
  ├─→ Ask: provider, supabase-ref, supabase-token, currency, plans
  │
  ├─→ /setup-supabase
  │     ├─→ Apply 001_create_subscriptions.sql
  │     ├─→ Apply 002_create_rpcs.sql
  │     └─→ Deploy [provider]-webhook Edge Function
  │
  ├─→ /setup-stripe (or /setup-razorpay)
  │     ├─→ Create Product via Stripe MCP
  │     ├─→ Create Price via Stripe MCP
  │     └─→ Create Payment Link via Stripe MCP
  │
  ├─→ Generate PayCraft.configure() code
  │
  └─→ /verify
        ├─→ Check table exists
        ├─→ Check RPCs exist
        └─→ Check webhook deployed
```

## Example Session

```
You: /setup

Claude: I'll set up PayCraft for you. First, a few questions:

1. Payment provider: stripe or razorpay?
   → stripe

2. Supabase project ref (from your project URL):
   → abc123xyz

3. Supabase access token:
   → sbp_...

4. Currency (e.g., inr, usd):
   → inr

5. Plans (name: price in paise):
   → monthly: 9900, quarterly: 24900, yearly: 84900

✓ Applying database migrations...
✓ is_premium() RPC created
✓ get_subscription() RPC created
✓ Deploying stripe-webhook...
✓ Creating Stripe products...
✓ Creating payment links...

Here is your PayCraft.configure() code:

PayCraft.configure {
    supabase(
        url = "https://abc123xyz.supabase.co",
        anonKey = "eyJ...",
    )
    provider(
        StripeProvider(
            paymentLinks = mapOf(
                "monthly"   to "https://buy.stripe.com/...",
                "quarterly" to "https://buy.stripe.com/...",
                "yearly"    to "https://buy.stripe.com/...",
            ),
            customerPortalUrl = "https://billing.stripe.com/p/login/...",
        )
    )
    ...
}

✓ Verification passed. PayCraft is ready!

Next: Add PayCraft to your app with /paycraft-setup
```
