---
id: API_REFERENCE
title: Endpoint reference
sidebar_label: Endpoint reference
description: All 15 management API operations — paths, scopes, filters and response shapes.
---

# Endpoint reference

Fifteen operations. Base URL `https://api.paycraft.mobilebytesensei.com/v1`, bearer auth, tenant
derived from the key.

For an interactive version you can call directly from the browser, use the
**[live reference](https://api.paycraft.mobilebytesensei.com/v1/docs)** — it is generated from the
same [OpenAPI 3.1 spec](https://api.paycraft.mobilebytesensei.com/v1/openapi.json), so it cannot
drift from what the server does.

| | Path | Scope |
|---|---|---|
| `GET` | [`/tenant`](#get-tenant) | `tenant:read` |
| `GET` | [`/readiness`](#get-readiness) | `readiness:read` |
| `GET` | [`/products`](#get-products) | `products:read` |
| `GET` | [`/products/{id}`](#get-productsid) | `products:read` |
| `POST` | [`/products/{id}/sync`](#post-productsidsync) | `products:sync` |
| `GET` | [`/providers`](#get-providers) | `providers:read` |
| `GET` | [`/sync`](#get-sync) | `products:read` |
| `POST` | [`/sync`](#post-sync) | `products:sync` |
| `GET` | [`/sync/events`](#get-syncevents) | `products:read` |
| `GET` | [`/subscribers`](#get-subscribers) | `subscribers:read` |
| `GET` | [`/entitlements`](#get-entitlements) | `subscribers:read` |
| `GET` | [`/coupons`](#get-coupons) | `coupons:read` |
| `GET` | [`/paywall`](#get-paywall) | `paywall:read` |
| `GET` | [`/webhooks`](#get-webhooks) | `webhooks:read` |
| `GET` | [`/audit`](#get-audit) | `audit:read` |

---

## `GET /tenant`

Plan, limits, and the calling key's own scopes — useful as a first call to discover what a
credential is permitted to do.

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  https://api.paycraft.mobilebytesensei.com/v1/tenant
```

```json
{
  "id": "ba973ad0-...",
  "name": "cappy",
  "plan": "pro",
  "subscriber_limit": 10000,
  "key": { "id": "0bb30f21-...", "scopes": ["readiness:read", "products:sync"] }
}
```

No credential columns are ever returned. The `tenants` row holds `api_key_live` and
`webhook_secret_live` beside the safe fields; the endpoint selects an explicit column list so a new
column cannot silently join the response.

---

## `GET /readiness`

Whether each provider can transact, per mode. **Start here** when asking "can we take a payment
yet".

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  https://api.paycraft.mobilebytesensei.com/v1/readiness
```

```json
{
  "providers": [
    {
      "provider": "stripe",
      "auth_kind": "key_pair",
      "live_ready": true,
      "test_ready": true,
      "test_detail": "test key pk_test_51R…lnau, 21 payment link(s)",
      "test_mechanism": "test_api_key",
      "manual_steps": null,
      "console_url": "https://dashboard.stripe.com/test/apikeys"
    }
  ],
  "summary": { "total": 4, "needs_manual_action": 2, "live_ready": 4, "test_ready": 2 }
}
```

| Field | Meaning |
|---|---|
| `auth_kind` | `key_pair` (Stripe, Razorpay, Cashfree) or `store` (Play, App Store) |
| `live_ready` / `test_ready` | Can this provider actually transact in that mode |
| `test_detail` | Why it is what it is — a key fingerprint and artifact count, or what is missing |
| `test_mechanism` | `test_api_key`, `license_tester` or `sandbox_apple_id` |
| `manual_steps` | Ordered steps for work no API can perform. `null` when the row is green |
| `console_url` | Where that work happens |

Credentials resolve from the **shared connection**, not the app row — providers are account-level
and apps share them. Payment links and plans stay app-scoped.

`summary.needs_manual_action` counts rows a person must act on, so a caller can branch without
inspecting every row.

---

## `GET /products`

The catalogue, with each provider's synced ids — one call answers whether a product actually landed
at Stripe, Play and the App Store.

**Filters:** `sku`, `type` · **Paged**

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  "https://api.paycraft.mobilebytesensei.com/v1/products?sku=cappy_plus_monthly"
```

```json
{
  "data": [{
    "sku": "cappy_plus_monthly",
    "type": "subscription",
    "stripe_product_id": "prod_...",
    "razorpay_plan_id_by_currency": { "INR": "plan_TfNsyhnZFcQpYF" },
    "razorpay_plan_id_by_currency_test": { "INR": "plan_TfNt0R6bl9BLR1" },
    "live_plan_ids_verified": true,
    "sync_state": { "stripe": { "status": "synced" } }
  }]
}
```

Razorpay plan ids are **mode-scoped**. `live_plan_ids_verified: false` means the live ids predate
that split and may have been written by a test sync — run a sync to rewrite them from the live
account.

---

## `GET /products/{id}`

One product with its per-currency pricing rows. A product id belonging to another tenant returns
**404**, never that tenant's data.

---

## `POST /products/{id}/sync`

Push one product to its providers. **Writes to live providers.**

**Query:** `provider` — narrow to `stripe`, `razorpay`, `cashfree`, `google_play` or `app_store`

```bash
curl -s -X POST -H "Authorization: Bearer $PAYCRAFT_KEY" \
  "https://api.paycraft.mobilebytesensei.com/v1/products/$ID/sync?provider=stripe"
```

No `confirm_count` — this names its single subject in the URL, so there is no unenumerated set to
confirm. Returns per-provider verdicts; read them.

---

## `GET /providers`

Connected providers and their payment-link maps.

**Filters:** `provider` · **Paged**

Never credentials. There is no endpoint that decrypts a provider secret, because an API that could
would be one leaked key away from being the provider account.

---

## `GET /sync`

The drift report — what a sync *would* change, plus the `confirm_count` that `POST /sync` requires.
Read-only. Always call this first.

```json
{
  "confirm_count": 1,
  "findings": [{ "kind": "test-links-missing", "subject": "provider:stripe" }]
}
```

| `kind` | Meaning |
|---|---|
| `product-missing-at-provider` | A product exists in PayCraft but not at the provider |
| `test-links-missing` | A test credential and live artifacts exist, but no test artifacts |
| `no-test-credential` | Live works; test mode has no credential to use |
| `active-provider-zero-links` | A connected provider has nothing to charge against |
| `active-provider-no-credential` | Marked active with no usable credential |
| `credential-mode-mismatch` | The stored mode disagrees with the key in use |
| `missing-currency-for-country` | A served country has no price row |
| `paywall-not-published` | Paywall changes exist but are unpublished |

---

## `POST /sync`

Run the drain. **Bulk-writes to live payment providers.**

**Body:** `{ "confirm_count": <from GET /sync> }`

Returns `synced`, `skipped`, `failed`, `needs_human` and a `run_id`. A mismatched count returns
**409** with the current number — re-read and retry.

---

## `GET /sync/events`

Per-provider events for a run. Where a sync summary says a provider failed, these rows say why.

**Filters:** `run_id`, `provider`, `status` · **Paged**

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  "https://api.paycraft.mobilebytesensei.com/v1/sync/events?run_id=$RUN_ID&status=failed"
```

---

## `GET /subscribers`

Subscription records — what a provider bills.

**Filters:** `email`, `status`, `provider`, `mode` · **Paged**

Filter by `mode` when answering a live question: a test-mode row answers a different one
convincingly.

---

## `GET /entitlements`

The canonical entitlement state — what PayCraft *grants*.

**Filters:** `app_user_id`, `provider`, `state` · **Paged**

Distinct from subscriptions: the two disagree during grace periods, refunds and store-side
cancellations, and this is the one an app should trust. `is_sandbox` is also the evidence that turns
store test readiness green.

---

## `GET /coupons`

Discount codes with their per-provider counterparts — Stripe coupon, Razorpay offer, store offer ids.

**Filters:** `code` · **Paged**

---

## `GET /paywall`

The paywall configuration the SDK renders. Useful as a CI snapshot: diff it between deploys and an
unintended change fails a check instead of reaching customers.

---

## `GET /webhooks`

Inbound webhook deliveries, with payloads stored **redacted** — this cannot leak card or customer
detail.

**Filters:** `provider`, `status`, `event_type`, `mode` · **Paged**

```bash
curl -s -H "Authorization: Bearer $PAYCRAFT_KEY" \
  "https://api.paycraft.mobilebytesensei.com/v1/webhooks?status=failed"
```

The question worth asking after a provider incident: did we drop anything?

---

## `GET /audit`

Who changed what — including this API's own actions, recorded as `actor_type: "api_key"` with the
key id. A key's activity is auditable by the same mechanism it uses to act.

**Filters:** `action`, `actor_type` · **Paged**
