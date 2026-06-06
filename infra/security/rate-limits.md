# PayCraft Cloud — Per-Endpoint Rate-Limit Policy

## Edge Function Rate Limits (Supabase)

| Endpoint | Bucket | Burst | Refill | Action |
|---|---|---|---|---|
| `GET /v2/config` | per-tenant | 60 req | 1 req/s | 429 + `Retry-After: 60` |
| `POST /v2/billing/upgrade` | per-tenant | 5 req | 0.1 req/s | 429 |
| `POST /stripe-webhook/{tenant}` | per-tenant | 200 req | 5 req/s | 429 + audit log |
| `POST /razorpay-webhook/{tenant}` | per-tenant | 200 req | 5 req/s | 429 + audit log |
| `POST /stripe-connect-oauth` | per-IP | 10 req | 0.05 req/s | 429 |
| `GET /v2/config` (unauthenticated) | per-IP | 10 req | 0.1 req/s | 429 |

## Cloudflare Zone-Level Limits

| Path Pattern | Bucket | Burst / Window | Action |
|---|---|---|---|
| `/functions/v1/v2-*` | per-IP | 100 req / 60s | Block (CF Ruleset) |
| `/(marketing)/*` | per-IP | 1000 req / 60s | JS Challenge |
| Dashboard `/api/v2/*` | per-user | 300 req / 60s | Block |

## SDK Client Limits

- `GET /v2/config` is cached client-side for `cache_ttl_seconds` (default 3600).
  SDK must NOT call it on every app launch — only on cache miss / force-refresh.
- Rate-limit header `X-RateLimit-Remaining` is forwarded in all 429 responses.

## Implementation

Rate limiting is enforced at two layers:
1. **Cloudflare** — zone-level rules (see `infra/dns/paycraft-cloud.tf#cloudflare_ruleset`)
2. **Supabase** — edge function `shared/rate-limit.ts` using `pg_rate_limit` extension
