# PLAN — Native sign-in by default, post-purchase account linking, full-screen paywall

Status: in-progress · Owner: PayCraft SDK · Created 2026-10-31

## Why

A store subscription (Google Play / StoreKit 2) is bound to an anonymous device id until the buyer
identifies. That is correct for buying (Apple 5.1.1: an account may never be required to buy or
restore an IAP) but it means the subscription cannot follow the buyer to their other platform.
Linking it to an identity is what makes Android <-> iOS restore work.

Today the only identity UI PayCraft has is an email field, plus Apple/Google buttons that render
**only when the host app wires an OAuth handler** — so in practice nobody sees them. The
`mbs/kmp-supabase-auth` library already does native Apple (`ASAuthorization`) and Google
(Credential Manager) sign-in over supabase-kt ComposeAuth, proven on physical devices.

## Decisions

| # | Decision |
|---|---|
| D1 | PayCraft **depends on** `cmp-supabase-auth` + `cmp-supabase-auth-compose` (never copies them) and installs them into PayCraft's OWN Supabase client via `kmpSupabaseAuthInstall`. Same targets (android, iosArm64, iosSimulatorArm64, jvm, js, wasmJs); same Kotlin / supabase-kt / AGP. Compose Multiplatform moves 1.11.1 -> 1.12.0 to match. |
| D2 | Native sign-in is the **default** OAuth handler: no host wiring. A host-provided `LocalPayCraftOAuthHandler` still overrides it. |
| D3 | A verified sign-in identifies the buyer: the email from PayCraft's own Supabase session goes through the existing login path, which re-links every store purchase to that email (`relinkStorePurchasesTo`, server `claimStoreTransaction`). |
| D4 | **Post-purchase link screen** — full screen, OPTIONAL ("Not now" always available), shown ONCE after a successful native store purchase when the buyer has no identity. Copy: *"Keep your subscription on all your devices. Sign in to restore it on any iPhone or Android, even after reinstalling."* Never shown before purchase; never blocks it. |
| D5 | Paywall default presentation is **full screen**; the close (X) stays immediate. |
| D6 | Provider config: Google uses the **app's own** web client id (passed to `PayCraft.initialize`), added to PayCraft Supabase's Google client-id list; Apple is enabled on PayCraft Supabase with each app's **bundle id** as a client id (ID-token flow needs no secret). |

## Out of scope (this plan)

- Removing the email restore path — it remains the fallback for web (Stripe/Razorpay) purchases.
- Apps that sign users in with their own auth getting a one-tap "use this account" — follow-up.

## Acceptance

- A1 Restore + device-conflict screens show native Apple/Google buttons with no host wiring.
- A2 After a successful Play / StoreKit purchase with no identity, the link screen shows once; "Not now" dismisses it and does not reappear for that purchase.
- A3 Signing in on the link screen moves the store record from the device id to the email (verified in production `entitlement_records`).
- A4 The same account on the other platform restores premium (cross-platform).
- A5 Paywall opens full screen; closing it works from any state (regression: SurfaceClosed).
- A6 Unit tests for D3/D4 logic; full JVM suite + Android/iOS compile green; device-verified on Android + iPhone.
