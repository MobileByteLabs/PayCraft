# cmp-paycraft-web — PayCraft for plain JavaScript websites

`cmp-paycraft` is a Kotlin Multiplatform SDK with a Compose paywall, so a website cannot use it
directly. `cmp-paycraft-web` is the same PayCraft contract for any website (Astro, Next.js, plain
HTML): an ES module with TypeScript types, no Compose, no Koin, no Supabase client — the browser's
own `fetch` and nothing else.

| You get | How |
|---|---|
| Sign in (Google / Apple) | `signIn(provider, idToken, nonce)` — the **same** identity path as the mobile SDK |
| Premium status | `premium()` (network) · `isPremium()` / `isAdFree()` (sync, cached) |
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

**Size** (measured 2026-11-08, esbuild bundle + minify of a page importing `PayCraftWeb`):
310 KB minified, **78 KB gzipped**. Most of it is the Kotlin standard library, kotlinx-coroutines and
kotlinx-serialization; `paycraft-web.mjs` itself is 120 KB unminified. Load it after first paint
(dynamic `import()`), not in the critical path.

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
