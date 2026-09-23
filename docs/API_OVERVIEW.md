---
id: API_OVERVIEW
title: Management API
sidebar_label: Overview
description: Server-to-server API for automating a PayCraft tenant — provider readiness, product sync, subscribers and audit.
---

# Management API

A server-to-server API for automating a PayCraft tenant from CI, a deploy pipeline, or an agent.

```
https://api.paycraft.mobilebytesensei.com/v1
```

**[Interactive reference →](https://api.paycraft.mobilebytesensei.com/v1/docs)** · **[OpenAPI 3.1 spec →](https://api.paycraft.mobilebytesensei.com/v1/openapi.json)**

## Why it exists

Every other PayCraft admin surface authenticates with a browser session. Most owner accounts sign in
with Google, which has no password, and Google refuses automated browsers outright — so before this
API there was no way to run an admin operation without a person at a keyboard.

That matters most for the question a release pipeline actually needs answered: *can this build take
a payment yet, in test and in live?*

## Your first call

Create a key under **Settings → Developer API** in the dashboard, then:

```bash
export PAYCRAFT_KEY="pcsk_..."

curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  https://api.paycraft.mobilebytesensei.com/v1/readiness | jq '.summary'
```

```json
{ "total": 4, "needs_manual_action": 2, "live_ready": 4, "test_ready": 2 }
```

## Authentication

Send your secret key as a bearer token:

```
Authorization: Bearer pcsk_...
```

Three things worth knowing:

**The tenant comes from the key.** No endpoint accepts a tenant id — not in a body, a query string
or a header. A bearer credential that let the caller name the tenant would be a key to every tenant.

**Keys are stored as a SHA-256 hash.** A database dump yields nothing usable, and a lost key cannot
be recovered. Mint a new one and revoke the old.

**`pcsk_` is not `pk_`.** The public `pk_live_` / `pk_test_` keys your app ships with are a different
class — they are embedded in every client binary by design. A `pcsk_` key can bulk-write to live
payment providers, so it belongs on a server and nowhere else.

## Scopes

Each endpoint requires exactly one scope, and a key carries a closed set. Grant only what the caller
needs: a read key cannot bulk-write to live providers even though both sit behind the same
authentication.

| Scope | Grants |
|---|---|
| `tenant:read` | `GET /v1/tenant` |
| `readiness:read` | `GET /v1/readiness` |
| `providers:read` | `GET /v1/providers` |
| `products:read` | `GET /v1/products`, `GET /v1/products/{id}`, `GET /v1/sync`, `GET /v1/sync/events` |
| `products:sync` | `POST /v1/sync`, `POST /v1/products/{id}/sync` — **writes to live providers** |
| `subscribers:read` | `GET /v1/subscribers`, `GET /v1/entitlements` |
| `coupons:read` | `GET /v1/coupons` |
| `paywall:read` | `GET /v1/paywall` |
| `webhooks:read` | `GET /v1/webhooks` |
| `audit:read` | `GET /v1/audit` |

A valid key used on an endpoint it lacks the scope for returns **403**, not 401 — the credential is
fine, the permission is not, and retrying will never help.

## Pagination

List endpoints take `limit` (1–200, default 50) and `offset`:

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  "https://api.paycraft.mobilebytesensei.com/v1/subscribers?limit=100&offset=200"
```

```json
{
  "data": [ ... ],
  "pagination": { "limit": 100, "offset": 200, "total": 842, "has_more": true }
}
```

A `limit` above 200 is **clamped, not rejected** — an out-of-range value means "as much as possible",
and failing the request only teaches clients to retry in a loop.

## Errors

| Status | Meaning |
|---|---|
| `400` | Malformed request body |
| `401` | Missing, malformed, unknown, revoked or expired key — all reported identically |
| `403` | Valid key, missing scope |
| `404` | No such resource **on your tenant** |
| `409` | `confirm_count` no longer matches — re-read the report ([see below](#writes-ask-twice)) |
| `413` | Body over 64 KB |
| `429` | Rate limited |
| `503` | A provider was unreachable, so the answer would be incomplete |

Errors carry a stable `error` code you can branch on:

```json
{ "error": "insufficient_scope", "detail": "this key does not carry 'products:sync'" }
```

Two deliberate choices. Unknown, revoked and expired keys are **indistinguishable** — telling them
apart would tell an attacker which guess was once real. And a `500` never names our infrastructure
or echoes a database error; the specifics go to our logs, because these responses are reachable
without authenticating.

## Writes ask twice

`POST /v1/sync` bulk-writes to live payment providers, so it requires the count from
`GET /v1/sync`:

```bash
N=$(curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
      https://api.paycraft.mobilebytesensei.com/v1/sync | jq .confirm_count)

curl -s -X POST -H "Authorization: Bearer $PAYCRAFT_KEY" \
  -H "content-type: application/json" -d "{\"confirm_count\": $N}" \
  https://api.paycraft.mobilebytesensei.com/v1/sync
```

A mismatch returns **409**: the drift set changed between looking and acting, which is exactly when
a bulk write to a billing provider should stop and ask again. The gate is kept for machine callers
on purpose — nobody watching is when a mismatched count matters most.

## A 200 is not "everything worked"

A sync reports per-provider verdicts. Read them:

```json
{
  "ok": true,
  "synced": 6,
  "skipped": [],
  "failed": [],
  "needs_human": [],
  "run_id": "9d780927-5974-43a0-bf6f-4e9e721ed2a3"
}
```

`skipped` is **not** a success — it means a provider could not be used, with the reason. When
something fails, pass `run_id` to `GET /v1/sync/events` for the per-provider detail.

## Rate limits

Three limits, all returning `429`:

| Limit | Applies to |
|---|---|
| 120 requests, refilling 1/s | Per tenant, after authentication |
| 20 failures/minute | Per source address, on rejected credentials |
| 600 requests, refilling 10/s | Per source address, on every request |

No legitimate client should meet these. If you do, `Retry-After` tells you how long to wait.

## What the API cannot do

**Google Play and App Store test mode cannot be enabled through any API.** Neither store exposes a
way to turn it on or to assert that it is on. Those readiness rows carry `manual_steps` — ordered
instructions for a person with a device — and turn green only when a real sandbox purchase reaches
PayCraft.

```json
{
  "provider": "google_play",
  "test_ready": false,
  "test_mechanism": "license_tester",
  "manual_steps": [
    "Play Console → your app → Setup → License testing",
    "Add the tester's Google account under \"License testers\" and save",
    "..."
  ],
  "console_url": "https://play.google.com/console"
}
```

Relay those steps to whoever can perform them. Every other provider reaches test readiness through a
test credential plus a product sync.

## Next

- **[Endpoint reference](./API_REFERENCE.md)** — all 15 operations with examples
- **[Recipes](./API_RECIPES.md)** — release gates, sync pipelines, support lookups
- **[MCP server](./MCP_SERVER.md)** — the same API as tools for an AI assistant
