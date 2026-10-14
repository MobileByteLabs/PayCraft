---
id: MCP_SERVER
title: MCP server
sidebar_label: MCP server
description: Give an AI assistant scoped, auditable access to PayCraft — provider readiness, product sync, subscribers and audit.
---

# MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server over the management API. Point
any MCP client at it and an assistant can answer "can we test payments yet", explain what is
blocking a provider, and run a product sync — with exactly the permissions the key you give it
carries.

```
https://mcp.paycraft.mobilebytesensei.com/
```

Transport is Streamable HTTP; authentication is the same `pcsk_` bearer token as the REST API.

## Connect

Create a key under **Settings → Developer API** and grant it only the scopes the assistant needs.

### Claude Code

```bash
claude mcp add --transport http paycraft https://mcp.paycraft.mobilebytesensei.com/ \
  --header "Authorization: Bearer $PAYCRAFT_KEY"
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paycraft": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://mcp.paycraft.mobilebytesensei.com/",
        "--header", "Authorization: Bearer ${PAYCRAFT_KEY}"
      ],
      "env": { "PAYCRAFT_KEY": "pcsk_your_key_here" }
    }
  }
}
```

### Any client

```bash
curl -X POST https://mcp.paycraft.mobilebytesensei.com/ \
  -H "Authorization: Bearer $PAYCRAFT_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`initialize`, `tools/list`, `tools/call` and `ping` are implemented. `GET` returns 405 — this server
never initiates messages, so it declines to hold open a stream that would only ever be idle.

## Tools

| Tool | Effect | Scope |
|---|---|---|
| `paycraft_apps` | **List the apps this key reaches** — start here with an account key | `apps:read` |
| `paycraft_create_app` | **Creates an app** and returns its publishable key | `apps:write` |
| `paycraft_attach_provider` | **Attaches a provider credential the account already holds** | `providers:write` |
| `paycraft_readiness` | Provider readiness, per mode, with manual steps | `readiness:read` |
| `paycraft_tenant` | Plan, limits, and the key's own scopes | `tenant:read` |
| `paycraft_products` | List the catalogue | `products:read` |
| `paycraft_product` | One product with pricing | `products:read` |
| `paycraft_providers` | Connected providers | `providers:read` |
| `paycraft_sync_report` | Drift report — what a sync would do | `products:read` |
| `paycraft_sync_run` | **Runs the sync drain** | `products:sync` |
| `paycraft_create_product` | **Adds a product to the catalogue** | `products:write` |
| `paycraft_update_product` | **Changes named product fields** (merge-safe; `trial_per_platform:null` clears) | `products:write` |
| `paycraft_set_product_pricing` | **Sets a product's per-country prices** (upsert; does not reach a store) | `products:write` |
| `paycraft_sync_product` | **Syncs one product** | `products:sync` |
| `paycraft_retire_product` | **Stops sales at the live stores**, then deactivates the row | `products:write` |
| `paycraft_sync_events` | Per-provider events for a run | `products:read` |
| `paycraft_subscribers` | Subscription records | `subscribers:read` |
| `paycraft_entitlements` | Canonical entitlement state | `subscribers:read` |
| `paycraft_coupons` | Discount codes | `coupons:read` |
| `paycraft_paywall` | Paywall configuration | `paywall:read` |
| `paycraft_webhooks` | Inbound webhook deliveries | `webhooks:read` |
| `paycraft_audit` | Audit trail | `audit:read` |

The two write tools are annotated `destructiveHint: true`, so clients that surface the distinction
will flag them before running.

## Onboarding a fresh app, end to end

One credential for the whole sequence — the account's `pcsk_` key. Nothing else is needed and no
provider secret ever travels.

```
1. paycraft_apps                      → learn which apps this key reaches
2. paycraft_create_app                → the new app + its publishable pk_ key
3. paycraft_attach_provider           → once per provider (stripe, google_play, app_store, …)
4. paycraft_create_product            → once per tier (weekly / monthly / quarterly / annual)
5. paycraft_set_product_pricing       → per-country prices for each product
6. paycraft_sync_product              → push each to its providers
7. paycraft_readiness                 → what still needs a human
```

Every step is idempotent, so an interrupted chain is safe to re-run: step 2 returns the existing
app with `created: false`, step 4 refuses a duplicate SKU unless you pass `upsert`, and step 5
upserts per locale.

**Steps 1–5 never touch a storefront.** Only step 6 writes to a live provider. A catalogue that
exists in PayCraft and has not been synced is not on sale, which is why every write response says
`synced: false` and names the sync call rather than letting the absence of an error read as
"shipped".

### Credentials are added once, by a human, in the dashboard

`paycraft_attach_provider` takes an `account_id`, never a key. Provider secrets live encrypted in
the account's `provider_accounts` row and are read only server-side by the sync; the API refuses a
body containing `secret`/`api_key`/`credential` outright. So the first app on a new Stripe account
still needs someone to paste that credential into the dashboard once — every app after it just
attaches, and the secret never enters an API call, a log, or an assistant's context.

Omit `account_id` to take the account's default connection for that provider. With several and no
default, the tool refuses and lists the candidates rather than guessing which account to bill
through.

### What step 7 cannot do for you

Both native stores flip test-readiness only after a REAL sandbox purchase, and expose no API to set
or check it. `paycraft_readiness` reports that as an ordered `manual_steps` list. A chain that
reported itself complete without it would be asserting a purchase nobody made.

## How it stays safe

**Tools call the REST handlers, not the database.** Authentication, scope enforcement, tenant
filtering, pagination clamping and the confirm-count gate all live in those handlers. A second
implementation would have to stay in step with them forever, and the half that drifted would be the
half deciding who reads whose billing data. Connecting an assistant therefore grants nothing its key
did not already allow.

**Give it a read-only key.** Grant only read scopes and the write tools refuse with a clear message.
The safest assistant is one that cannot spend money.

**Writes still ask twice.** `paycraft_sync_run` requires the count from `paycraft_sync_report`. An
agent cannot bulk-write to live providers on a set nobody looked at.

**Everything is attributable.** Actions land in the audit trail as `actor_type=api_key` with the key
id — readable through `paycraft_audit`.

## What an assistant cannot do

**Google Play and App Store test mode cannot be enabled by any tool.** Neither store exposes an API
for it. Those readiness rows carry ordered `manual_steps` for a person with a device, and turn green
only when a real sandbox purchase reaches PayCraft.

A good assistant relays those steps. It should never claim to have completed them — and the server
tells it so in the `instructions` returned at `initialize`.

## Good first questions

Once connected, these exercise the tools naturally:

- *"Can we take test payments yet? What's blocking anything that isn't ready?"*
- *"Show me what a product sync would change before we run it."*
- *"Did any webhooks fail in the last day, and why?"*
- *"Is a.customer@example.com's subscription active, and does their entitlement agree?"*

The last one is worth understanding: a subscription is what a provider bills, an entitlement is what
PayCraft grants. They disagree during grace periods and refunds, and the entitlement is the one your
app should trust.
