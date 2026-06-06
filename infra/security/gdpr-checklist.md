# PayCraft Cloud — GDPR Compliance Checklist

Last reviewed: 2026-06-06

## Lawful Basis
- [x] Processing based on contract (subscription billing) — GDPR Art. 6(1)(b)
- [x] Cookie banner on marketing pages — consent for analytics cookies only
- [x] Privacy Policy at /legal/privacy (published)
- [x] Terms of Service at /legal/terms (published)
- [x] DPA template at /legal/dpa (signed addendum for Pro+ customers on request)

## Data Minimization
- [x] Only email, device fingerprint, subscription status stored per subscriber
- [x] Webhook payloads stored for `analytics_retention_days` per tier (Free=7d, Pro=90d, Enterprise=365d)
- [x] Payment card data NEVER stored (Stripe/Razorpay tokenize at their end)
- [x] PII stripped from Sentry events (see `dashboard/lib/sentry.client.ts`)

## Data Subject Rights
- [x] Export endpoint: `POST /api/v2/gdpr/export` — returns JSON blob of all tenant data
- [x] Deletion endpoint: `POST /api/v2/gdpr/delete` — cascade-deletes per `gdpr-deletion.sql`
- [x] Both endpoints require tenant_admin role + MFA re-auth

## Sub-Processors
- [x] Sub-processor list at /legal/subprocessors
- Key sub-processors: Supabase (Postgres), Vercel (hosting), Postmark (email), Sentry (error tracking), Cloudflare (CDN/WAF), Stripe (payments), BetterStack (uptime)

## Data Retention
- Subscription records: retained for 7 years (legal/tax obligation)
- Audit logs: per tier (see above)
- Deleted tenant data: purged within 30 days of deletion request

## Annual Review
- [ ] Next review due: 2027-06-06
