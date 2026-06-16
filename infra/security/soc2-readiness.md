# PayCraft Cloud — SOC2 Type 1 Readiness Checklist

Target: SOC2 Type 1 audit — 6 months post-launch (Dec 2026)

## Security Controls

### CC6 — Logical Access Controls
- [x] Role-based access (Owner / Admin / Viewer) via `tenant_team_members.role`
- [x] MFA enforced for tenant_admin operations via Supabase Auth TOTP
- [x] API keys scoped per tenant, rotatable via `/api-keys` page
- [x] Supabase RLS on all tables — deny-by-default
- [ ] Annual access review process — post-launch

### CC7 — System Operations
- [x] Audit log (`tenant_audit_log`) — all config changes, subscription events, team changes
- [x] Uptime monitoring (BetterStack, 4 probes)
- [x] Error tracking (Sentry, PII-stripped)
- [x] Automated deploy + smoke test CI (`deploy-cloud.yml`)
- [ ] Incident response runbook — see `infra/monitoring/sla-dashboard.md`

### CC8 — Change Management
- [x] All changes via PR review (protected `main` branch)
- [x] CI gate on every PR (lint, type-check, unit tests)
- [x] Migrations reviewed separately — `supabase db diff` checked in PR
- [ ] Change management policy doc — post-launch

### CC9 — Risk Mitigation
- [x] Data encrypted at rest (Supabase pgcrypto for tokens)
- [x] TLS 1.3 via Cloudflare + Vercel (no plaintext)
- [x] Supabase connection pooling (PgBouncer, no direct DB exposure)
- [x] Webhook signature verification (HMAC-SHA256)
- [ ] Vendor management policy — post-launch
- [ ] Penetration test — scheduled post-launch

## Availability Controls

- [x] 99.9% SLA target (see `infra/monitoring/sla-dashboard.md`)
- [x] Multi-region Cloudflare CDN (US, EU, APAC probes)
- [x] Vercel Edge Network (global)
- [ ] Backup restoration test — quarterly cadence, first run post-launch
