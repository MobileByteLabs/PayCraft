---
id: ENGINEERING_STANDARDS
title: Engineering standards
sidebar_label: Engineering standards
description: The stack the dashboard and website are built in, and the gates that keep them production-grade.
---

# Engineering standards

The single source of truth for **what the web surfaces are written in** and **what "production
grade" means here**. The website is not a separate project with a separate stack — it is the same
Next.js application as the dashboard, and this page is why.

## One application, three route groups

`paycraft.mobilebytesensei.com`, `api.paycraft…` and `mcp.paycraft…` are all custom domains on the
**same** Cloudflare Pages project, served by one Next.js app that routes by path:

| Route group | Serves | Auth |
|---|---|---|
| `app/(marketing)` | Public website — home, pricing, docs entry, legal, status | None |
| `app/(dashboard)` | Authenticated product — providers, products, subscribers, webhooks, audit | Supabase session |
| `app/api/v1` · `app/api/mcp` | Management API + MCP server | `pcsk_` bearer key |

**The website redesign happens inside `app/(marketing)`.** There is no new project to create, no
second framework to learn, and no second deploy pipeline to keep in step. That is the whole reason
this is written down: the most expensive mistake available here is standing up a separate
marketing site in a different stack, because it immediately drifts from the product it describes —
which is exactly what happened with the `docusaurus/` tree that was deleted on 2026-09-24.

## The stack

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript, `strict: true` | 5.6 |
| Framework | Next.js, App Router | 14.2.35 |
| UI | React | 18.3 |
| Styling | Tailwind CSS | 3.4 |
| Data | Supabase (`@supabase/ssr`) | 0.5 / 2.45 |
| Tests | Jest | 30.4 |
| Lint | ESLint + `eslint-config-next` | 8 / 14.2.35 |
| Build + deploy | `@cloudflare/next-on-pages` → Cloudflare Pages | 1.13 |

**Why this and not something else:** it is already here, already deployed, already covered by 528
tests, and already carries the security middleware. For a website whose main job is to describe
this product accurately, sharing the product's own codebase is the feature — the pricing page can
read real plan data, and the dashboard preview can render real components rather than screenshots
that rot.

Server components are the default. Reach for `"use client"` only where interactivity genuinely
requires it; every client component ships to the browser.

## Security

Non-negotiable, and enforced rather than documented:

**Tenant identity comes from the credential, never the request.** `lib/api-key-auth.ts` resolves
the tenant from the hashed `pcsk_` key. A body or query field naming a tenant is ignored. A test
in `__tests__` asserts this for every `/api/v1` route.

**Every response carries the security headers.** `lib/api-security.ts` exports `SECURITY_HEADERS`
and `withSecurityHeaders()`; HSTS with preload, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Live-verified on
`api.paycraft.mobilebytesensei.com`.

**Errors never name infrastructure.** `queryFailed()` logs the real database code server-side and
returns a generic `query_failed` to the caller. A guard fixture in `__tests__/support/guards.ts`
holds verbatim real defects and verbatim false-positives, so the assertion cannot silently stop
firing — the failure mode it exists to prevent.

**Rate limiting is in Postgres, not memory.** `auth_attempt_buckets` and
`request_throttle_buckets`. An in-memory limiter is per-isolate on Cloudflare and therefore never
fires; measured 20×401 → 20×429 against the live deployment.

**No secret value ever reaches a log, a transcript, or a response.** Secrets resolve through the
vault by alias. `.env` files are forbidden in this project.

**Bodies are size-capped** at 64KB, and the one route accepting a body validates its field where
it is consumed (`lib/sync-drain.ts:45` checks `typeof confirmCount !== "number"` before use).

ESLint additionally blocks `dangerouslySetInnerHTML`, `eval`, unsafe `target="_blank"`, and
casting a parsed request body with `as` — that last one is a compile-time claim, not a runtime
check, and reads as validation when it is not.

## What CI actually gates

`dashboard-ci.yml` runs on every PR touching `dashboard/**`:

```
npm ci                              lockfile must match package.json
npx tsc --noEmit                    typecheck
npx eslint . --ext .ts,.tsx         lint, errors block
npx jest --ci                       528 tests, no --passWithNoTests
```

Two notes on how this is tuned, because both were deliberate:

**Lint gates on errors, not warnings.** Three `react-hooks/exhaustive-deps` warnings survive and
are allowed. They are documented deliberate dependency arrays — `components/realtime-refresh.tsx`
uses `tables.join(",")` to guard an inline array in a way ESLint cannot statically verify. Failing
the build on them would force either a false "fix" or a blanket disable; a visible warning is
better than either.

**`react/no-unescaped-entities` is off.** It fires on every apostrophe in prose — 106 hits across
22 files — and it is not a safety rule; React escapes all interpolated content regardless. On a
codebase whose marketing pages are mostly prose, it is pure noise.

> Lint became a real gate on 2026-09-24. Before that, `npm run lint` was `next lint` with no
> ESLint installed and no config, so running it opened Next's interactive setup prompt. A script
> that can only hang is worse than no script — it reads as covered.

## Writing for these surfaces

Voice and visual language live in `idea-layer/design-system/DESIGN.md`; tokens in
`design-tokens.yaml`. The short version: name things the way a developer would, state limits as
plainly as capabilities, and let the accent be violet-700 while semantic state colour stays
separate — a dashboard that paints "healthy" and "brand" the same colour cannot show state at a
glance.

## Reference

- Deploy pipeline: `.github/workflows/deploy-cloud.yml` (Supabase → dashboard → docs → smoke)
- DNS and domains: `infra/dns-records.md`
- Security surface: `dashboard/lib/api-security.ts`, `dashboard/lib/api-key-auth.ts`
- Design system: `idea-layer/design-system/`
