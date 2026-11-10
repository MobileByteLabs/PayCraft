# cmp-paycraft-web — PayCraft for plain JavaScript websites

`cmp-paycraft` is a Kotlin Multiplatform SDK with a Compose paywall, so a website cannot use it
directly. `cmp-paycraft-web` is the same PayCraft for any website (Astro, Next.js, plain HTML): an ES
module with TypeScript types, built on `cmp-paycraft-core` — the logic the apps run — with no UI
toolkit, no DI container and no Supabase client at runtime; the network is the browser's own `fetch`.

| You get | How |
|---|---|
| Sign in (Google / Apple) | `signIn(provider, idToken, nonce)` — the **same** identity path as the mobile SDK |
| Premium status | `premium()` (network) · `isPremium()` / `isAdFree()` (sync, cached) |
| Plan + renewal | `subscription()` → `{plan, status, provider, renewsAt, cancelAtPeriodEnd, trialEndsAt}` or null |
| Products + sign-in client ids | `config()` |
| Checkout | `checkoutUrl(sku, currency)` — Razorpay subscription or Stripe payment link |
| Device conflict | `useThisDevice()` — moves the account to this browser, as the app does |
| Sign out | `signOut()` |

One subscription works everywhere: a buyer who paid in the app is premium on the website and the
other way round, because both resolve premium from the same PayCraft tenant by the same verified email.

## Build

```bash
./gradlew :cmp-paycraft-web:jsBrowserProductionLibraryDistribution
# → cmp-paycraft-web/build/dist/js/productionLibrary/
#     paycraft-web.mjs  paycraft-web.d.mts  package.json  (+ kotlin stdlib / coroutines / serialization .mjs)
```

Use the directory as a local package (`"paycraft-web": "file:…/productionLibrary"`) or copy it into
the site. npm publishing is not set up yet.

## Architecture (3.0)

`cmp-paycraft-web` is a thin `@JsExport` facade over `cmp-paycraft-core`. Endpoints, headers, `/config`
decoding (the app's own `SuiteConfig` model, so region prices are the same `resolved_price`), device RPCs
and checkout routing come from core's `PayCraftContract` — the same code the apps run — so a backend
change is made once. The facade owns only browser concerns: `fetch`, localStorage (`paycraft_web_token`,
`paycraft_web_email`, `paycraft_web_premium` `{isPremium,email,at}`, `paycraft_web_device_id`; 6 h premium
cache), the device name and Promises. It never starts Koin.

**Size gate:** `./gradlew :cmp-paycraft-web:webBundleSize` (part of `check`) fails above 150 KB, measured
as every `.mjs` in the directory minified (terser) + gzipped: 141 KB in 3.0 (2.5.2: 88 KB). A page importing
`PayCraftWeb` loads 11 of those files — 140 KB, i.e. almost all of it; the increase is the stdlib /
serialization code that decodes the app's config model, 15 KB of core, and Ktor's client core plus three
`cryptography-kotlin` modules that the JS compiler imports for their eager initialisers (core depends on
Ktor / supabase-kt; the browser SDK never calls them, but their initialisers run at import). Load it after
first paint (dynamic `import()`), not in the critical path.

**Chunks a page loads** (the import graph from `paycraft-web.mjs`, side-effect imports included; useful for
tests that block the SDK): `paycraft-web.mjs`, `paycraft-cmp-paycraft-core.mjs`, `kotlin-kotlin-stdlib.mjs`,
`kotlinx-coroutines-core.mjs`, `kotlinx-atomicfu.mjs`, `kotlinx-serialization-kotlinx-serialization-core.mjs`,
`kotlinx-serialization-kotlinx-serialization-json.mjs`, `ktor-ktor-client-core.mjs`,
`cryptography-kotlin-cryptography-core.mjs`, `cryptography-kotlin-cryptography-provider-webcrypto.mjs`,
`cryptography-kotlin-cryptography-random.mjs`. The other `.mjs` files in the directory are never imported.
The build corrects two compiler artefacts: the duplicated `initHook` declaration in `paycraft-web.d.mts` is
removed, and `package.json` ships `"dependencies": {}` (nothing imports an npm package);
`infra/web-api-diff.sh` checks both, and type-checks the `.d.mts` with `skipLibCheck` off.

**Since 3.0:** a product without `trial_duration_days` reports 7 (core's default, as in the app), not null;
`/config` products need the fields the live server sends (`id`, `type`, `display_name`; `resolved_price.source`).

## Usage

```ts
import { PayCraftWeb } from "paycraft-web";

// Only the tenant's PUBLISHABLE key (pk_live_… / pk_test_… / pk_<hex>) — public by design, like the
// app's PayCraft.initialize(apiKey). Never put a secret key in a web page.
const pc = new PayCraftWeb("pk_live_…");                 // PayCraft Cloud
// const pc = new PayCraftWeb("pk_<hex>", "test");      // force test mode (modeless keys)
// const pc = new PayCraftWeb(pk, null, "https://pay.example.com", "<anon key>");   // self-hosted PayCraft

// 1. Ads — decide synchronously, before any ad script loads. Unknown/expired/signed-out = false.
if (!pc.isAdFree()) loadAds();
pc.premium().then((s) => { if (s.isPremium) hideAds(); });   // refresh in the background

// 2. Sign in — get an ID token from Google Identity Services or Sign in with Apple JS, using the
//    client ids from config(), then hand it to PayCraft:
const { googleClientId, appleServicesId, products } = await pc.config();
const r = await pc.signIn("google", googleIdToken, null);      // or ("apple", appleIdToken, nonce)
if (r.conflict) {
  // The account is active on another device (r.conflictingDeviceName) and this browser is NOT premium
  // yet. PayCraft allows one active device per account, on any platform — useThisDevice() moves premium
  // HERE and signs the other device out. Ask first; never call it automatically.
  if (confirm(`Use premium here instead of ${r.conflictingDeviceName}?`)) await pc.useThisDevice();
}

// 3. Checkout (needs a signed-in buyer — the purchase is matched back by this email)
location.href = await pc.checkoutUrl("pro_monthly", "INR");
```

Every promise rejects with a `PayCraftWebError` (an `Error`): `err.code` is stable
(`sign_in_required`, `unknown_sku`, `no_payment_link`, `no_web_provider`, `identity_unverified`,
`http_<status>`, `network_error`, `bad_response`) and `err.message` carries the server's text.

**Test vs live.** The 2nd constructor argument `mode` (`"test"` | `"live"`) wins; without it a
`pk_test_…` key means test and anything else live. Tenants created since migration 148 have one
modeless key (`pk_<hex>`), so pass `"test"` to use test payment links and sandbox checkout.

**Checkout routing** matches the app: the product's own provider, its payment link for the mode when
one exists (one-time / lifetime products, Stripe), otherwise Razorpay server checkout (subscriptions).
Without a `currency`, the price the buyer saw is used, then USD, then the first available link.

## Contract with the server

| Call | Endpoint |
|---|---|
| `config()` | `GET functions/v1/config?apiKey=` |
| `signIn()` | `POST functions/v1/identity-token/verify` → `POST rest/v1/rpc/register_device` (with the **verified** email only) |
| `premium()` | `POST rest/v1/rpc/check_premium_with_device` |
| `subscription()` | `POST rest/v1/rpc/get_subscription` |
| `useThisDevice()` | `POST rest/v1/rpc/transfer_to_device` |
| `checkoutUrl()` | Razorpay: `POST functions/v1/checkout-initiate?apiKey=` · Stripe: payment link + `prefilled_email` (URL-encoded) |

`config`, `identity-token` and `checkout-initiate` answer browser preflights through
`supabase/functions/_shared/cors.ts` (these functions must be deployed with it for a website to call
them). PostgREST RPCs are served with CORS by Supabase.

## Storage and security notes

- **One active device per account.** A buyer premium on their phone who signs in on the web gets
  `conflict: true` and is not premium in the browser until they choose `useThisDevice()` (which moves
  premium off the phone). Browsers that report the same name (e.g. two "Chrome on macOS") for the same
  account share one device entry on the server — that is server behaviour (`register_device` reuses a
  token by name + platform), not a bug in this SDK.

- `localStorage` keys: `paycraft_web_device_id`, `paycraft_web_token`, `paycraft_web_email`,
  `paycraft_web_premium` (`{isPremium, email, at}`, trusted for 6 hours). Every access is guarded:
  blocked storage or a static-site build never throws — it just means "not signed in".
- The device token grants premium STATUS only (ad-free, pro features); it cannot pay, refund or change
  an account. A script injected into the host page (XSS) could read it — keep the site's own
  Content-Security-Policy tight.
- Pro features gated on `isPremium()` are a convenience check in the browser, not DRM.
