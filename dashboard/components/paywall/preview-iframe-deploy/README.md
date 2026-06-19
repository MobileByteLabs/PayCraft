# Paywall preview iframe — Cloudflare Pages deploy target

The dashboard's `Paywall designer` LIVE PREVIEW embeds a true-WYSIWYG iframe
of the actual cmp-paycraft Compose UI rendered via Kotlin/JS. The bundle is
built by `:cmp-paycraft:jsBrowserDistribution` (gradle) and served from
Cloudflare Pages so what the dashboard shows is exactly what the SDK ships
to consumer apps on device.

## URL contract

| Channel | URL |
|---|---|
| Production | `https://paywall-preview.paycraft.mobilebytesensei.com` |
| Branch previews | per-branch `paycraft-paywall-preview.pages.dev` subdomain |
| Local dev override | set `NEXT_PUBLIC_PAYWALL_PREVIEW_URL=http://localhost:8080` in `dashboard/.env.local` |

## Deploy pipeline

`.github/workflows/deploy-paywall-preview.yml` runs on every push to `main`
or `development` (and on `workflow_dispatch`) when files under
`cmp-paycraft/**` or this directory change. It:

1. Builds the Kotlin/JS bundle (`:cmp-paycraft:jsBrowserDistribution`) — output
   at `cmp-paycraft/build/dist/js/productionExecutable/`.
2. Uploads to Cloudflare Pages project `paycraft-paywall-preview` via
   `cloudflare/wrangler-action@v3`.
3. `main` branch deploys land at the production domain; other branches get
   per-branch preview URLs surfaced as PR comments.

## One-time setup (admin)

Required GitHub secret + Cloudflare resources:

- **`secrets.CLOUDFLARE_API_TOKEN`** — Cloudflare API token with `Pages:Edit`
  scope on the MobileByteSensei account (`a4ee76f3d0dc36d7cf7350c01d39d526`).
  Create at https://dash.cloudflare.com/profile/api-tokens.
- **Cloudflare Pages project `paycraft-paywall-preview`** — create one-time
  at https://dash.cloudflare.com/a4ee76f3d0dc36d7cf7350c01d39d526/workers-and-pages
  → `Create application` → `Pages` → `Connect to Git`? — skip Git, this workflow
  uses `direct upload`. Just create an empty Pages project named
  `paycraft-paywall-preview`.
- **Custom domain `paywall-preview.paycraft.mobilebytesensei.com`** — bind in
  the Pages project's `Custom domains` tab. DNS is managed at the
  `paycraft.mobilebytesensei.com` zone — add a `CNAME` row pointing
  `paywall-preview` at `paycraft-paywall-preview.pages.dev`. SSL provisions
  automatically.
- **CORS allow-origin** — the preview bundle must accept
  `postMessage({type:"paycraft:config",config,stateName})` only from the
  dashboard origin(s). The bundle's `Preview.kt` validates `event.origin`
  against an allowlist that includes `https://paycraft.mobilebytesensei.com`
  and `https://*.pages.dev` (for branch previews). For local dev, the bundle
  ships with a permissive `localhost:*` allowance.

## Verifying the deploy

```bash
# Smoke check — should return 200 and serve index.html
curl -s -o /dev/null -w "%{http_code}\n" https://paywall-preview.paycraft.mobilebytesensei.com/

# Iframe-embedding check — verify X-Frame-Options is NOT set (Cloudflare Pages
# default is no XFO header, but worth confirming before relying on it)
curl -s -I https://paywall-preview.paycraft.mobilebytesensei.com/ | grep -i "x-frame-options"
```

## Manual rollback

If a bad bundle deploys, redeploy the prior commit via:

```bash
gh workflow run deploy-paywall-preview.yml --ref <previous-sha> -f production=true
```

Or revert the offending commit on `main` and let the workflow re-run.

## Future — bundle size budget

The Kotlin/JS bundle today is ~1.2 MB gzipped (mostly Compose runtime + skia).
Acceptable for an iframe preview but worth watching. If the bundle grows past
3 MB gzipped the iframe load latency starts hurting the dashboard editor UX.
A future epic could split the preview into a thin host page + dynamic chunk
of the Compose UI (D7 — out of scope for sub-plan 01 of paywall-v2).
