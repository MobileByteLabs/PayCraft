# PayCraft Public SLA + Status Dashboard

> Phase 4 of paycraft-v2-production-readiness — defines what we publish to
> the public status page, how uptime is computed, and where the data lives.

**Effective:** 2026-06-17
**Public URL:** https://status.paycraft.mobilebytesensei.com (upptime, GitHub Pages)
**Operating cadence:** Targets evaluated monthly; reported quarterly on the status page.

---

## Published SLA targets

These are **public commitments**. The wording on the status page should match
verbatim.

| Surface | Target | Measurement basis |
|---|---|---|
| Dashboard (`paycraft.mobilebytesensei.com`) | **99.5%** monthly uptime | upptime probe every 5 min, HTTP 200 from `/api/health` |
| Webhook ingress (`/api/webhooks/{provider}`) | **99.9%** monthly | upptime probe + signed-HMAC PING every 5 min |
| Stripe → SDK propagation | **median ≤ 5 s** / **p95 ≤ 30 s** | end-to-end fixture: test charge → `subscriptions.status = active` |
| Dashboard p95 page latency | **≤ 1500 ms** at the edge | Vercel Analytics; rolling 30-day p95 |

We **do not** publish SLAs for Stripe / Razorpay themselves — those are the
providers' own SLA documents and the dashboard links to them.

---

## What we monitor on the public page

upptime config lives in [`infra/status-page/.upptimerc.yml`](../infra/status-page/.upptimerc.yml)
(deferred — created during DNS step). The shape:

```yaml
owner: MobileByteLabs
repo: paycraft-status
sites:
  - name: Dashboard
    url: https://paycraft.mobilebytesensei.com
    expectedStatusCodes: [200]
  - name: Health endpoint
    url: https://paycraft.mobilebytesensei.com/api/health
    expectedStatusCodes: [200]
    headers:
      - "User-Agent: upptime"
  - name: Stripe webhook receiver
    url: https://paycraft.mobilebytesensei.com/api/webhooks/stripe/__ping
    method: POST
    body: '{"ping": true}'
    expectedStatusCodes: [200]
status-website:
  cname: status.paycraft.mobilebytesensei.com
  logoUrl: https://paycraft.mobilebytesensei.com/logo.svg
  name: PayCraft
  introTitle: PayCraft platform status
  introMessage: |
    Real-time status of the PayCraft dashboard, webhook ingress, and
    end-to-end payment propagation pipeline. Updated every 5 minutes.
```

---

## Where SLA data flows

```
upptime cron (GitHub Actions, every 5 min)
  → probes each `sites[].url`
  → opens / closes GitHub issues per outage in MobileByteLabs/paycraft-status
  → commits results to `history/` (uptime, response-time)
  → rebuilds the Next.js status site on GitHub Pages

status.paycraft.mobilebytesensei.com  (CNAME → upptime gh-pages)
  → renders status overview + 30 / 60 / 90 day uptime charts
```

End-to-end payment propagation latency is *not* upptime — it ships from a
GitHub Actions cron that:

1. Hits Stripe test API with a `charge.succeeded` fixture.
2. Polls `/functions/v1/get-subscription?email=qa@paycraft.mobilebytesensei.com` until
   `status == active`.
3. Computes elapsed time, emits a Prometheus-text line, commits it to
   the `paycraft-status/metrics/` branch — upptime renders a custom
   "Propagation latency" widget on the status page.

---

## Incident classification

| Severity | Customer impact | Status page state | Comms channel |
|---|---|---|---|
| **SEV-1** | Dashboard fully down OR webhook ingress >95% failing OR p95 propagation > 5 min | "Major outage" (red) | Public status post + Twitter/X + Slack #status |
| **SEV-2** | Single provider failing (e.g. Stripe webhook 5xx) OR dashboard slow (p95 > 5 s) | "Partial outage" (yellow) | Public status post |
| **SEV-3** | Latency degradation but no customer-visible failures; staging/canary issues | "Degraded performance" (yellow) | Status post (no Twitter/X) |
| Internal-only | Dev tooling, CI red, doc bugs | Not posted publicly | Linear ticket |

---

## Quarterly SLA reporting

On the 1st of every quarter:

1. Run `bash infra/status-page/quarterly-report.sh > docs/reports/sla-YYYYQN.md`
   (deferred — generated from `history/` JSON).
2. Compare each surface's actual uptime to its published target.
3. If we missed a target by ≥ 0.1 percentage points, write a post-mortem in
   `docs/reports/postmortem-YYYYMMDD-<slug>.md` and link from the status page.
4. Commit to `development`; PR to `main`.

---

## Related

- DR runbook: `docs/DR_RUNBOOK.md`
- Incident response: `docs/INCIDENT_SIMULATION.md`
- Sentry custom events: `dashboard/lib/sentry-events.ts`
- Acceptance criteria: `plan-layer/.../paycraft-v2-production-readiness/GOAL.md` AC40-AC43
