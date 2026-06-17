# PayCraft Cloud — SLA Targets + On-Call Runbook

## SLA Targets

| Tier | Uptime SLA | Support Response |
|------|-----------|-----------------|
| Free | No SLA (best effort) | Community forums |
| Pro | 99.5% / month | 24h email |
| Enterprise | 99.9% / month | 4h email + Slack |

## On-Call Rotation

- **Primary**: oncall@paycraft.mobilebytesensei.com (PagerDuty)
- **Escalation**: Fired after 5 consecutive failed probes (= 5 min outage)
- **Severity levels**: SEV1 (full outage) → immediate page; SEV2 (degraded) → 15 min response; SEV3 → next-business-day

## Runbook

### /v2/config returns 5xx
1. Check Supabase Status at https://status.supabase.com
2. `supabase functions list --project-ref $PROD_REF` — confirm v2-config deployed
3. Check CloudFlare WAF logs — may be rate-limit false positive
4. Rollback: `supabase functions deploy v2-config --project-ref $PROD_REF --import-map false`

### Dashboard Vercel deploy failed
1. `vercel logs --app paycraft-cloud --last 100`
2. Check `.github/workflows/deploy-cloud.yml` run for error
3. Rollback: `vercel rollback --app paycraft-cloud`

### Stripe webhook failures spike
1. Check `tenant_audit_log WHERE event_type = 'webhook_delivery_failed'` — identify tenant(s)
2. Verify Stripe webhook endpoint URL in Stripe Dashboard = `https://api.paycraft.mobilebytesensei.com/functions/v1/stripe-webhook/{tenant_id}`
3. Replay failed events via Stripe Dashboard > Webhooks > Recent deliveries

## Incident Response

1. **Detect** — PagerDuty alert or user report
2. **Acknowledge** — within 5 min (Pro/Enterprise SLA)
3. **Triage** — identify scope (1 tenant vs all tenants vs infrastructure)
4. **Mitigate** — rollback, disable feature flag, scale up, reroute DNS
5. **Resolve** — root cause confirmed fixed
6. **Post-mortem** — written within 48h; stored at `infra/postmortems/YYYY-MM-DD-{title}.md`
