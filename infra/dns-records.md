# PayCraft DNS Records — copy-paste reference

> Phase 2 T5 + Phase 4 T10 of paycraft-v2-production-readiness — every record
> the production environment needs. `mobilebytesensei.com` is registered at
> **Hostinger** and its DNS is served by **Cloudflare** (`haley.ns.cloudflare.com`
> / `noah.ns.cloudflare.com`); copy each row below into the Cloudflare DNS panel.

**Effective:** 2026-09-17 (was 2026-06-17 — Wix/Vercel era)
**Operator:** Run `dig +short` after each add to verify propagation (≤ 5 min).

> **Migration note.** DNS moved off Wix and the dashboard moved off Vercel. Rows
> fronted by Cloudflare are **proxied** (orange-cloud), so `dig` returns Cloudflare
> anycast IPs (`104.21.x` / `172.67.x`) rather than the CNAME target — a proxied
> record verifies by `curl`, not by matching the target in `dig` output.

---

## Production records (4)

| Subdomain | Type | Target | Owner | Purpose |
|---|---|---|---|---|
| `paycraft.mobilebytesensei.com` | CNAME (proxied) | `paycraft.pages.dev` | Cloudflare Pages | Dashboard + marketing + `/api/*` + `/legal/*` |
| `docs.paycraft.mobilebytesensei.com` | CNAME | `paycraft-docs.pages.dev` | Cloudflare Pages | Docusaurus public docs site |
| `status.paycraft.mobilebytesensei.com` | CNAME | `mobilebytelabs.github.io` | GitHub Pages (upptime) | Public status page |
| `api.paycraft.mobilebytesensei.com` | CNAME | `mlwfgytjxlqyfxcgpysm.supabase.co` | Supabase | Direct Supabase API (reserved — currently unused, ships in v2.1) |

---

## TTL

Use `1800` (30 min) for production records. Drop to `300` (5 min) only when
mid-migration; never to `0` (some recursors round up regardless).

---

## SSL

All four targets issue Let's Encrypt certs automatically — **no manual cert
upload**. Verify after CNAME propagates:

```bash
# Should each return "HTTP/2 200"
curl -sI https://paycraft.mobilebytesensei.com/api/health | head -1
curl -sI https://docs.paycraft.mobilebytesensei.com/ | head -1
curl -sI https://status.paycraft.mobilebytesensei.com/ | head -1
```

The `api.paycraft.mobilebytesensei.com` CNAME is **provisioned but unused** —
Supabase auto-issues a cert via its custom-domain feature. Leave it
disconnected at the Supabase side until v2.1 needs it.

---

## Apex behavior

`mobilebytesensei.com` apex itself remains MobileByteSensei's marketing site.
PayCraft does NOT take over the apex.

If the apex needs to redirect to PayCraft someday (e.g. brand consolidation),
use a Cloudflare **Redirect Rule** (Rules → Redirect Rules) to
`https://paycraft.mobilebytesensei.com`. Cloudflare's CNAME-flattening would
technically permit an apex CNAME, but a redirect rule is the reversible choice
and keeps the apex free for the marketing site.

**Mail lives on this apex — do not touch it while editing PayCraft rows.**
Zoho serves it: `MX` → `mx{,2,3}.zoho.in`, SPF `v=spf1 include:zoho.in ~all`,
DKIM at `zmail._domainkey`, DMARC at `_dmarc` (`p=none`). These survived the
Wix → Hostinger/Cloudflare move; deleting or re-proxying them silently breaks
inbound mail for the whole org, PayCraft support address included.

---

## Verification

After all 4 records propagate:

```bash
# G-2 gate (zero-leak validator) + DNS smoke
bash infra/zero-leak-check.sh && \
  for h in paycraft docs status; do
    code=$(curl -fsS -o /dev/null -w "%{http_code}" \
      "https://${h}.paycraft.mobilebytesensei.com/" || echo FAIL)
    echo "  ${h}.paycraft.mobilebytesensei.com → $code"
  done
```

Expected:

```
✅ G-2 zero-leak check PASS — no 'paycraft.cloud' references in production paths.
  paycraft.paycraft.mobilebytesensei.com → 200   (dashboard, /api/health=ok)
  docs.paycraft.mobilebytesensei.com → 200       (Docusaurus landing)
  status.paycraft.mobilebytesensei.com → 200     (upptime board)
```

---

## Rollback

If a record mis-targets and the production app is down:

1. Delete the offending row from the **Cloudflare DNS panel** (zone
   `mobilebytesensei.com`).
2. Wait ≤ 5 min for negative-cache TTLs to expire.
3. Re-add the correct row.

The dashboard's underlying Cloudflare Pages deployment never moves; only the DNS
front-door flips. Browser cache may hold the broken IP — incognito-test after
each mutation.

A **DNS** rollback is the wrong tool for a bad *build*: to undo a deployment,
roll back the Pages deployment itself (Cloudflare dashboard → Pages → `paycraft`
→ Deployments → *Rollback*), which repoints the production alias without any DNS
change. See `docs/PRODUCTION_LAUNCH_RUNBOOK.md` § Cloudflare Pages.

---

## Related

- `infra/zero-leak-check.sh` — G-2 validator referenced above
- `docs/PRODUCTION_LAUNCH_RUNBOOK.md` — broader deploy flow
- `docs/SLA_DASHBOARD.md` — uptime targets the status page reports against
- GOAL.md AC15, AC16, AC39 — acceptance criteria
