# PayCraft Roadmap

> Live roadmap. Items move from **Planned** → **In Progress** → **Shipped** as PRs land.
> For released versions, see [CHANGELOG.md](CHANGELOG.md). For planned epics with
> full plans, see `plan-layer/project-plans/mbs/PayCraft/active/`.

---

## Now — v2.1 production-readiness window

**Epic in flight:** [`paycraft-v2-production-readiness`](https://github.com/mobilebytesensei/claude-product-cycle/tree/development/plan-layer/project-plans/mbs/PayCraft/active/paycraft-v2-production-readiness)

| Phase | Status | Scope |
|------:|:------:|-------|
| **P1 — Self-monetize** | 🟡 In progress | Stripe live activation (3-7 days) · PayCraft-as-tenant-1 · vault rename |
| **P2 — Domain + docs** | 🟡 In progress | paycraft.mobilebytesensei.com canonical · Docusaurus deploy at docs.* |
| **P3 — DR + PCI + legal** | 🟢 Mostly shipped | Daily R2 backup workflow · restore script · DR runbook · PCI SAQ-A scope · DPA sub-processor table |
| **P4 — Observability + abuse** | 🟢 Mostly shipped | Edge rate-limit middleware · 11 webhook handlers wrapped · Sentry helpers · support inbox · charge.refunded handler · API key rotation UX |
| **P5 — E2E + Maven publish** | 🟡 In progress | cmp-paycraft 2.0.0 ready · README + reels-downloader case study shipped · RLS isolation test (11/11) · Maven Central upload pending |

**Epic close criteria:** all 5 phase gates (G-1..G-5) plus the cross-phase G-EPIC gate pass.
A first real public customer can sign up at `paycraft.mobilebytesensei.com`, complete
Stripe Connect onboarding, and the published cmp-paycraft v2.0.0 SDK gates real
premium features in reels-downloader against the production tenant.

---

## Next — v2.1 (planned)

- **Subscriber detail event-history page** — single dashboard view of a tenant's
  subscription lifecycle across all providers
- **Webhook replay UI** — tenants can re-fire a webhook event from the dashboard
  for debugging
- **Stripe Tax integration surface** — multi-currency display in marketing pricing
  (deferred from v2.0 — held until first cross-border customer)
- **Dashboard mobile responsiveness** — beyond existing breakpoints; deferred
  until usage data warrants the work
- **Observability dashboard expansion** — Sentry tenant-tag breakdowns on the
  dashboard page (consumer of `dashboard/lib/sentry-events.ts`)

---

## Later — v2.2

- **2FA / MFA beyond Google OAuth** — TOTP + hardware key support
- **Tenant white-labeling** — custom-domain dashboards per tenant
- **Cross-region Postgres replicas** — defer until ARR > $100K justifies the spend
- **v1.2 provider expansion** — PayPal native, Google Play Billing, App Store
  Connect (separate epic; out of scope for v2.x)

---

## Adopted-but-paused (long-tail backlog)

- Webhook health dashboard widget (data already collected by `webhook-health` edge function)
- Per-tenant secrets viewer with reveal/copy/rotate (extends `/settings/api-keys` patterns)
- Tier metering surface (events per tenant per month vs the tier_definitions caps)
- Sentry → status page auto-incident creation (when SEV-1 spikes are detected)

---

## How items move

1. **Adopt** — record idea here under **Adopted-but-paused** with a one-line note.
2. **Spec** — write `GOAL.md` via `/goal-analysis-project <slug>`.
3. **Plan** — break down via `/goal-planning-project <slug>` into a PLAN.md
   (leaf or epic with sub-plans).
4. **Implement** — execute via `/goal-implement-project <slug>`.
5. **Ship** — PR merges to `development`, then `/paycraft-deploy ship` promotes
   to `main`.
6. **Update this file** — move the row to the right column with a brief shipped-date note.

---

## Related

- [README.md](README.md) — what PayCraft is, install + quick start
- [CHANGELOG.md](CHANGELOG.md) — released versions with semver
- [docs/PRODUCTION_LAUNCH_RUNBOOK.md](docs/PRODUCTION_LAUNCH_RUNBOOK.md) — manual deploy procedures
- [docs/SLA_DASHBOARD.md](docs/SLA_DASHBOARD.md) — published SLA targets
- [docs/INCIDENT_SIMULATION.md](docs/INCIDENT_SIMULATION.md) — quarterly DR drill scenarios
