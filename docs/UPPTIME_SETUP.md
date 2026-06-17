# PayCraft Status Page (upptime) Setup

> Phase 4 T9-T11 of paycraft-v2-production-readiness — fork the upptime
> template, wire the PayCraft monitor list, and attach the status subdomain.

**Window:** ≤ 20 min from `gh repo fork` to a live status page.

---

## What this gives you

A free, self-hosted, GitHub Pages-backed status page at
`https://status.paycraft.mobilebytesensei.com` that:

- Probes every 5 min from GitHub Actions (free tier)
- Auto-opens GitHub issues on each outage + closes them on recovery
- Renders 30 / 60 / 90 day uptime charts per probe
- Costs $0/month (free GitHub Pages + free Actions minutes)

---

## Step 1 — Fork the template (≤ 2 min)

```bash
gh repo fork upptime/upptime \
  --org MobileByteLabs \
  --fork-name paycraft-status \
  --clone=true \
  --remote=true

cd paycraft-status
```

---

## Step 2 — Wire the PayCraft probe list

Replace `.upptimerc.yml` with the canonical PayCraft monitor set:

```bash
cat > .upptimerc.yml <<'EOF'
owner: MobileByteLabs
repo: paycraft-status

sites:
  - name: Dashboard
    url: https://paycraft.mobilebytesensei.com
    expectedStatusCodes: [200]
    method: GET
    icon: https://paycraft.mobilebytesensei.com/favicon.ico

  - name: Health endpoint
    url: https://paycraft.mobilebytesensei.com/api/health
    expectedStatusCodes: [200]
    method: GET
    headers:
      - "User-Agent: upptime"
    assignees:
      - therajanmaurya

  - name: Marketing pricing
    url: https://paycraft.mobilebytesensei.com/pricing
    expectedStatusCodes: [200]

  - name: Marketing legal/terms
    url: https://paycraft.mobilebytesensei.com/legal/terms
    expectedStatusCodes: [200]

  - name: Auth login
    url: https://paycraft.mobilebytesensei.com/auth/login
    expectedStatusCodes: [200]

  - name: Stripe webhook receiver (ping)
    url: https://paycraft.mobilebytesensei.com/api/webhooks/stripe/__ping
    expectedStatusCodes: [200, 400]   # 400 OK = missing signature header, endpoint live
    method: POST
    body: '{"ping":true}'

  - name: Razorpay webhook receiver (ping)
    url: https://paycraft.mobilebytesensei.com/api/webhooks/razorpay/__ping
    expectedStatusCodes: [200, 400]
    method: POST
    body: '{"ping":true}'

  - name: Docs site
    url: https://docs.paycraft.mobilebytesensei.com/
    expectedStatusCodes: [200]

status-website:
  cname: status.paycraft.mobilebytesensei.com
  logoUrl: https://paycraft.mobilebytesensei.com/logo.svg
  name: PayCraft
  introTitle: PayCraft platform status
  introMessage: |
    Real-time status of the PayCraft dashboard, webhook ingress, and end-to-end
    payment-propagation pipeline. Probed every 5 minutes. Published SLA targets
    at https://paycraft.mobilebytesensei.com/docs/SLA_DASHBOARD.

assignees:
  - therajanmaurya

notifications:
  - type: github-issue
    automerge: true
EOF

git add .upptimerc.yml
git commit -m "wire paycraft monitors"
git push origin master
```

---

## Step 3 — Enable GitHub Pages

In the `paycraft-status` repo settings → Pages:

- Source: GitHub Actions
- Custom domain: `status.paycraft.mobilebytesensei.com`
- Enforce HTTPS: ✅ (auto-flips on after cert provisions)

GitHub auto-issues a Let's Encrypt cert within ≤ 5 min of the DNS CNAME landing.

---

## Step 4 — DNS CNAME (operational)

Add to Wix DNS (or whoever manages `mobilebytesensei.com`):

```text
status.paycraft.mobilebytesensei.com  CNAME  mobilebytelabs.github.io  TTL=1800
```

See `infra/dns-records.md` for the full record list.

---

## Step 5 — First probe run

Trigger the workflow manually to skip waiting for the 5-min cron:

```bash
gh workflow run uptime.yml --repo MobileByteLabs/paycraft-status
gh workflow run response-time.yml --repo MobileByteLabs/paycraft-status
gh workflow run graphs.yml --repo MobileByteLabs/paycraft-status
gh workflow run site.yml --repo MobileByteLabs/paycraft-status
```

Wait ≤ 5 min for `site.yml` to finish → visit
`https://status.paycraft.mobilebytesensei.com/`. All 8 probes should report
green within the first round.

---

## Step 6 — Verify (Phase 4 T11)

```bash
# Manual probe of each surface
for url in \
  https://paycraft.mobilebytesensei.com/api/health \
  https://docs.paycraft.mobilebytesensei.com/ \
  https://status.paycraft.mobilebytesensei.com/ \
; do
  code=$(curl -fsS -o /dev/null -w "%{http_code}" "$url" || echo FAIL)
  printf "%-60s %s\n" "$url" "$code"
done
```

Expected: 3 × 200.

---

## What goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| CNAME → "no such host" 24h after add | DNS not propagated | `dig +short status.paycraft.mobilebytesensei.com` from multiple resolvers |
| Status page 404 | GitHub Pages source not set to Actions | repo Settings → Pages → Source: Actions |
| All probes RED at once | Bad CNAME or app fully down | Verify dashboard reachable directly first; if yes, probe URLs misconfigured |
| Stripe `__ping` 405 / 500 | Endpoint hasn't been added | Add a no-op POST handler at `dashboard/app/api/webhooks/stripe/__ping/route.ts` (returns 200) OR drop the probe from `.upptimerc.yml` |

---

## Related

- `docs/SLA_DASHBOARD.md` — published SLA targets that this page reports against
- `docs/INCIDENT_SIMULATION.md` — drill scenarios that exercise the page
- `infra/dns-records.md` — full DNS reference
- GOAL.md AC38-AC40 — Phase 4 acceptance criteria
