# Checkout API contract (for the PayCraft SDK)

This is the contract the `cmp-paycraft` KMP SDK consumes for routed
checkouts (Stripe + Razorpay + Cashfree + UPI Direct via one unified
flow). The dashboard hosts both endpoints in `dashboard/app/api/checkout-*`.

## Flow at a glance

```
SDK                                  PayCraft server
 │                                         │
 │  GET /api/checkout-options              │
 │  ?product_id=…&country=IN&currency=INR  │
 │ ──────────────────────────────────────▶ │
 │                                         │  routes via:
 │                                         │  • provider_method_registry
 │                                         │  • tenant_payment_methods
 │                                         │  • tenant_providers
 │                                         │  • tenant_routing_rules
 │                                         │
 │  ◀─── { resolved, options: [...] } ─── │
 │                                         │
 │  show picker, customer chooses          │
 │  collect email (required)               │
 │                                         │
 │  POST /api/checkout-initiate            │
 │  { product_id, method, customer }       │
 │ ──────────────────────────────────────▶ │
 │                                         │  • UPI Direct → records intent
 │                                         │  • Razorpay sub → creates subscription
 │                                         │  • Stripe → prefills email
 │                                         │
 │  ◀──── { url, ... } ────────────────── │
 │                                         │
 │  open url in browser / WebView          │
 │  (or render QR for upi:// on iOS)       │
 │                                         │
 │  customer pays in their app             │
 │                                         │
 │                          provider POST → /functions/v1/{provider}-webhook/{tenant_id}
 │                                         │  flips subscription to active
 │                                         │
 │  SDK polls /functions/v1/config         │
 │  isPremium → true                       │
 │                                         │
```

## `GET /api/checkout-options`

Read-only, no side effects. Returns every eligible method sorted by fee.

### Query params

| param | type | required | notes |
|---|---|---|---|
| `product_id` | UUID | yes | `tenant_products.id` |
| `country` | ISO 3166-1 alpha-2 | no | falls back to CDN header → merchant country |
| `currency` | ISO 4217 | no | falls back to currency-from-country → product.base_currency |

### Response 200

```json
{
  "resolved": { "country": "IN", "currency": "INR" },
  "options": [
    {
      "method": "direct_upi",
      "display_name": "Direct UPI (no PSP)",
      "provider": "direct_upi",
      "url": "upi://pay?pa=merchant@oksbi&am=999.00&cu=INR&tn=…&tr=PCxxxx",
      "estimated_fee_percent": 0,
      "supports_subscription": false,
      "currency": "INR",
      "reference": "PCxxxx-xxxxxx-XXXXX",
      "qr_payload": "upi://pay?...",
      "recommended": true,
      "badge": "0% fees",
      "requires_initiate": true
    },
    {
      "method": "razorpay",
      "display_name": "Razorpay — UPI",
      "provider": "razorpay",
      "url": "https://rzp.io/i/xxxx",
      "estimated_fee_percent": 0.5,
      "supports_subscription": true,
      "currency": "INR",
      "recommended": false,
      "requires_initiate": true
    }
  ]
}
```

### Response 409

```json
{
  "error": "no_eligible_method",
  "resolved": { "country": "IN", "currency": "INR" },
  "message": "No connected payment method can fulfil this checkout in the customer's currency. Connect Stripe, Razorpay, or configure UPI at /providers."
}
```

The SDK should surface this as "merchant hasn't configured payment for
your region — contact support" (this is a config bug, not a customer bug).

### Option fields

| field | type | description |
|---|---|---|
| `method` | string | one of `direct_upi`, `stripe_card`, `razorpay`, `cashfree_upi` |
| `display_name` | string | human-readable label for the picker UI |
| `provider` | string | underlying provider — used for branding / logos |
| `url` | string | placeholder URL; **do not open directly when `requires_initiate=true`** |
| `estimated_fee_percent` | number | for UI hint ("you pay 0%, merchant pays 2%") |
| `supports_subscription` | boolean | true if this method handles recurring |
| `currency` | string | ISO 4217 |
| `reference` | string \| undefined | UPI only — the `tr` field, for reconciliation |
| `qr_payload` | string \| undefined | UPI only — same value as `url`, for QR code rendering on iOS/desktop |
| `recommended` | boolean | exactly ONE option has this true (cheapest); render with primary CTA styling |
| `badge` | string \| undefined | "0% fees", "Recommended", "Instant" — for chip beside the title |
| `requires_initiate` | boolean | when true, POST `/api/checkout-initiate` first; never open `url` directly |

## `POST /api/checkout-initiate`

Idempotent per (product_id, method, customer.email) — calling twice with
the same args creates the same UPI intent / Razorpay subscription.

### Body

```json
{
  "product_id": "uuid",
  "method": "razorpay",
  "customer": {
    "email": "user@example.com",
    "name": "Jane Doe",
    "phone": "+919999999999",
    "country": "IN",
    "currency": "INR"
  }
}
```

Only `customer.email` is required; `name` / `phone` are forwarded to the
provider for prefilled checkout and SMS notifications when relevant.

### Response 200

```json
{
  "url": "https://rzp.io/i/xxxx",
  "method": "razorpay",
  "provider": "razorpay",
  "currency": "INR",
  "subscription_id": "sub_NXyzABCD123",
  "note": "Customer authorizes UPI Autopay mandate; subscription.authenticated webhook flips PayCraft to active."
}
```

For UPI Direct:

```json
{
  "url": "upi://pay?pa=merchant@oksbi&am=999.00&cu=INR&tn=…&tr=PCxxxx",
  "method": "direct_upi",
  "provider": "direct_upi",
  "currency": "INR",
  "reference": "PCxxxx-xxxxxx-XXXXX",
  "qr_payload": "upi://pay?..."
}
```

### Response 400 / 404 / 409 / 500

| status | meaning |
|---|---|
| 400 | bad body (missing fields, malformed) |
| 404 | product not found for this tenant |
| 409 | method not eligible (e.g. UPI Direct for a subscription product) — SDK should fall back to another option from `checkout-options` |
| 500 | upstream provider failure (Razorpay API down, etc) — retry with backoff |

## SDK implementation guidance

### Auth

Both endpoints accept the dashboard session cookie OR a PayCraft `pk_…`
API key in the `Authorization: Bearer pk_…` header. SDKs always use the
API key path.

### Opening URLs

Per platform:

| platform | `upi://` | `https://...` |
|---|---|---|
| Android | open via `Intent.ACTION_VIEW` — OS shows UPI app picker | open via `CustomTabsIntent` |
| iOS | `UIApplication.openURL` works IF a UPI app is installed; otherwise render `qr_payload` as a QR code (we recommend `EFQRCode`) | open via `SFSafariViewController` |
| Desktop / web | always render `qr_payload` as QR (no `upi://` handler) | open in new tab |
| KMP common | abstract via `expect/actual` `openCheckoutUrl(url, method)` |

### Picker UI

When `options.length > 1`, render a picker. Recommended layout:

```
Pay for Pro Monthly

  ★ Direct UPI            0% fees · instant      [Pay]
    Razorpay UPI          0.5% · supports subs
    Razorpay Card         2%
    Stripe Card           4.4% · international
```

The starred row is `recommended: true`. Tapping any row → POST initiate →
open returned URL.

### Reconciliation

For `direct_upi` the SDK doesn't get an automatic completion signal —
either:
- Display "Waiting for payment confirmation" and poll `/functions/v1/config`
  every 10s (the merchant marks paid manually in the dashboard)
- Or display "Show this reference (`xxx`) at your bank; you'll be activated
  within X hours" and let `BillingManager.refreshStatus()` resolve later

For PSP methods (razorpay/stripe/cashfree) the webhook fires within
seconds → `BillingManager.refreshStatus(force=true)` on app foreground.

### Fallback chain

If `initiate` returns 409, walk down the `options` array and retry with
the next method. UPI Direct → Razorpay UPI → Razorpay Card → Stripe.
Surface "tried X methods, none worked" to the customer only after
exhausting the list.

## Backward compatibility

The legacy `BillingManager.fetchPaymentLink(sku)` path stays usable —
internally it now calls `/api/checkout-options` and returns the first
option's URL (or the static cached Payment Link as fallback). New SDK
callers should migrate to the explicit options / initiate flow to get
multi-method picker + UPI Direct support.
