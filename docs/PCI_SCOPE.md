# PayCraft PCI DSS Scope Statement

> Phase 3 of paycraft-v2-production-readiness — formal scope declaration so
> adopters' compliance teams have a citeable paper trail.

**Effective:** 2026-06-17
**Scope category:** SAQ-A (Self-Assessment Questionnaire A)
**Signed by:** Rajan Maurya, Founder — MobileByteSensei
**Review cadence:** Annual; next review 2027-06-17

---

## Statement of scope

PayCraft (https://paycraft.mobilebytesensei.com) **does NOT** capture, process,
transmit, or store any of the following cardholder data elements as defined by
PCI DSS:

- **Primary Account Number (PAN)** — full card number
- **Cardholder name** (when collected adjacent to PAN)
- **Service code** / **Expiration date** (when collected adjacent to PAN)
- **Card verification value** (CVV / CVC / CVC2)
- **Card track data** (magnetic stripe / chip equivalent data)
- **PIN / PIN block**

All payment collection is delegated to PCI DSS **Level 1** certified service
providers:

| Provider | Role | Attestation URL |
|---|---|---|
| Stripe, Inc. | Card capture (Stripe Elements / Checkout), payment processing | https://stripe.com/docs/security/stripe |
| Razorpay Software Private Ltd. | Card capture (Razorpay Checkout), payment processing (India) | https://razorpay.com/security/ |

PayCraft's systems receive only **tokenized identifiers** and lifecycle event
metadata via signed webhooks:

- Stripe payment_intent IDs, customer IDs, subscription IDs
- Razorpay payment IDs, subscription IDs, plan IDs
- Provider event metadata (status, amount, currency, period dates)

---

## In scope (cardholder data environment)

The following systems handle cardholder data — and are not operated by
PayCraft:

| System | Operator | PCI status |
|---|---|---|
| Stripe Elements / Checkout (in-iframe card capture) | Stripe | Level 1 service provider |
| Stripe REST API (payment intents, customers, refunds) | Stripe | Level 1 service provider |
| Razorpay Checkout (in-iframe card capture) | Razorpay | Level 1 service provider |
| Razorpay REST API (orders, payments, subscriptions) | Razorpay | Level 1 service provider |

---

## Out of scope (PayCraft systems)

These PayCraft components **never** see raw cardholder data. They handle only
tokens, identifiers, and event metadata:

| System | Component | Why out of scope |
|---|---|---|
| Dashboard (`paycraft.mobilebytesensei.com`) | Next.js on Vercel | No card capture forms; payment flows redirect to Stripe / Razorpay hosted checkout |
| Framework-supabase database | Postgres + RLS + pgsodium-encrypted credentials | Stores tenant config + token IDs + event logs. **No PAN ever persisted.** |
| Edge Functions (webhook handlers) | Deno on Supabase | Receive signed webhooks containing token IDs + event metadata. Verify signature, persist event log, update derived state. |
| KMP SDK (`cmp-paycraft`) | Multi-platform Kotlin | Client app reads subscription status by API key. Never collects card data. |
| DR backups | Cloudflare R2 | Postgres dumps contain token IDs + tenant config. No PAN. |

---

## Encryption at rest

PayCraft applies field-level encryption (pgsodium AES-256-GCM via
`crypto_secretbox_easy`) to:

- `tenant_providers.keys` — provider API credentials (out of PCI scope but
  protected for tenant trust)
- `tenant_stripe_connect.access_token_enc` / `refresh_token_enc` — OAuth tokens
- `tenant_providers.webhook_secret_*` — webhook signing secrets

Encryption keys are stored in `encryption_key_config` and rotated via
`rotate_api_key()` RPC. The framework-supabase service role is the only
identity authorized to decrypt.

---

## Network exposure surface

| Endpoint | Auth | What it processes |
|---|---|---|
| `https://paycraft.mobilebytesensei.com/*` | Supabase Auth (Google OAuth) | Dashboard pages + JSON API; tenant config CRUD |
| `https://paycraft.mobilebytesensei.com/api/webhooks/{provider}` | Provider HMAC signature | Tokenized event metadata only |
| `https://mlwfgytjxlqyfxcgpysm.supabase.co/functions/v1/*` | Provider HMAC | Edge Function webhook receivers |

No customer-facing card capture endpoints. All checkout is provider-hosted.

---

## Compliance posture

| Requirement | Status |
|---|---|
| SAQ-A self-assessment | ✅ Applicable; PayCraft does not store PAN |
| SAQ-A-EP self-assessment | ❌ Not applicable; PayCraft does not redirect with card data in URL |
| SAQ-D (full PCI DSS) | ❌ Not applicable; PayCraft is not a merchant of record |
| Third-party attestation (RoC / AoC) | ⏳ Deferred until ARR > $250K or first enterprise customer requires |
| Annual founder sign-off | ✅ This document, signed at top |

---

## Customer compliance asks

When a customer's compliance team asks "is PayCraft PCI-compliant?":

1. Share this document.
2. Highlight: **SAQ-A scope**; **delegation to Stripe + Razorpay**.
3. Direct them to `legal/dpa` for sub-processor list (includes Stripe / Razorpay).
4. For enterprise asks requiring AoC: schedule a call; defer commitment.

---

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-06-17 | Rajan Maurya | Initial document — Phase 3 of paycraft-v2-production-readiness |
