# PayCraft docs site

Public Docusaurus site for `https://docs.paycraft.mobilebytesensei.com`.
Phase 2 of `paycraft-v2-production-readiness`.

> **Cloudflare Pages config:** Production branch `main`, build command
> `cd docs-site && npm install && npm run build`, build output
> `docs-site/build`, environment `NODE_VERSION=20`. No root-directory
> override needed — Cloudflare clones the full PayCraft repo.

## What this is

A thin Docusaurus shell that serves the existing `docs/*.md` tree at the
PayCraft repo root — no content duplication. Edits land in `../docs/` and
trigger a Cloudflare Pages rebuild on push to `main`.

## Local development

```bash
cd docs-site
npm install
npm start                # http://localhost:3000
```

## Build

```bash
npm run build
# output → docs-site/build/
```

## Deploy

Wired in `.github/workflows/docs-deploy.yml` (Phase 2 T6 — separate file). On
push to `main`, the workflow:

1. Installs Node 20 + runs `npm ci` in `docs-site/`
2. Runs `npm run build`
3. Uploads `docs-site/build/` to Cloudflare Pages project `paycraft-docs`
4. Cloudflare attaches the CNAME `docs.paycraft.mobilebytesensei.com`

DNS setup (Phase 2 T5):

```text
docs.paycraft.mobilebytesensei.com  CNAME  paycraft-docs.pages.dev
```

## Adding pages

1. Create the markdown file at `../docs/<NAME>.md`.
2. Add the route to `sidebars.ts` if you want it visible in the left nav.
3. Run `npm start` and verify hot-reload works.
4. Commit + push → Cloudflare Pages auto-deploys.

## Related

- `docs/PRODUCTION_LAUNCH_RUNBOOK.md` — manual deploy steps if the workflow breaks
- `infra/zero-leak-check.sh` — gate that fails CI on stale domain refs in markdown

<!-- Triggers Cloudflare Pages auto-build after Git settings were corrected (2026-06-18):
     - Production branch: development → main
     - Build command: cd docs-site && npm install && npm run build
     - Build output: docs-site/build -->
