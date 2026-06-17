# PayCraft v2.0 Launch Announcement Copy

## Product Hunt

**Title:** PayCraft — RevenueCat for Kotlin Multiplatform

**Tagline:** Multi-provider subscription billing, one SDK line, all from a dashboard.

**Description (260 chars):**
PayCraft is a multi-provider subscription billing platform for Kotlin Multiplatform.
Wire Stripe, Razorpay, Paddle (+7 more) — configure products, prices, and paywall
design in the dashboard. Integrate with `PayCraft.initialize("pk_live_...")` and
`PayCraftPaywall()`. Free tier covers 100 subscribers, then pay-as-you-go.

**First comment:**
Hey Product Hunt! 👋 I'm Rajan, the developer behind PayCraft.

The core problem: KMP devs using Stripe have to hard-code payment links in their app.
Change a price → new release → App Store review wait. With PayCraft v2.0, products and
pricing live in the dashboard. Your subscribers see the new price the moment you hit save.

Free tier is intentionally generous — 100 active subscribers + 10K webhook events/month.
Most indie apps launch under that. Pro is $29/month flat plus $0.10 per extra subscriber,
no surprise invoices.

Try the sample: https://github.com/MobileByteLabs/paycraft-sample-cloud
Docs: https://paycraft.mobilebytesensei.com/docs

Happy to answer any questions below!

---

## Hacker News (Show HN)

**Title:** Show HN: PayCraft — RevenueCat for Kotlin Multiplatform (integrate in 2 lines)

**Body:**
Hey HN! I'm Rajan, building PayCraft for KMP apps that want subscription billing
without committing to a single payment provider.

The library wraps Stripe, Razorpay, Paddle, PayPal, Paystack (+5 more) behind a
single thin SDK. You configure products, prices, and paywall design in the dashboard
at paycraft.mobilebytesensei.com — your app code is:

```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
PayCraftPaywall()
```

Change any product, price, or paywall template from the dashboard. No app store
re-submit required.

**Pricing:**
- Free tier — 100 active subscribers + 10K webhook events/month (no card required)
- Pro — $29/month + $0.10 per subscriber over 100
- Enterprise — self-host license (bring your own Supabase)

**What works today:**
- 10 providers wired
- Multi-tenant Supabase backend (27 migrations, encrypted provider keys, audit log)
- 3 paywall templates (Minimal / Premium / Dark)
- Trial / Subscription / Lifetime product types
- Per-country pricing via Stripe Pricing API
- Next.js 14 dashboard deployed to Vercel

**What's next (roadmap):**
- Google Play Billing + Apple StoreKit 2 native (Q4 2026)
- Cohort analytics + A/B paywall testing
- Stripe Tax integration

Sample: https://github.com/MobileByteLabs/paycraft-sample-cloud
Docs: https://paycraft.mobilebytesensei.com/docs

Would love feedback on SDK shape and pricing tiers.

---

## Twitter / X (thread)

1/ Shipping PayCraft v2.0 today — RevenueCat-style subscription billing for Kotlin Multiplatform.

2/ Two lines of code:
```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
PayCraftPaywall()
```
That's the entire integration.

3/ Everything else — products, prices, paywall template, branding, providers — lives at paycraft.mobilebytesensei.com. Change it anytime, no app store re-submit.

4/ Supports 10 providers today: Stripe, Razorpay, Paddle, PayPal, Paystack, and more. Multi-provider checkout shows a bottom sheet. Single provider? Sheet auto-skips.

5/ Pricing tiers:
- Free — 100 subscribers, 10K webhooks/mo
- Pro — $29/mo + $0.10/subscriber overage
- Enterprise — self-host on your own Supabase

6/ Sample app (3 lines, works on Android / iOS / Desktop / Web):
https://github.com/MobileByteLabs/paycraft-sample-cloud

7/ Docs + free signup: https://paycraft.mobilebytesensei.com

---

## LinkedIn

PayCraft v2.0 is live — a RevenueCat-style subscription billing platform for Kotlin Multiplatform developers.

The entire SDK integration:
```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
PayCraftPaywall()  // renders a full paywall UI
```

Products, pricing, paywall templates, and provider configuration all live in the dashboard at paycraft.mobilebytesensei.com. Update prices without App Store reviews. Switch providers without touching code.

Key features:
• 10 payment providers (Stripe, Razorpay, Paddle, PayPal, Paystack + more)
• 3 built-in paywall templates + custom branding
• Per-country pricing via Stripe Pricing API
• Trial / Subscription / Lifetime product types
• Free tier: 100 subscribers + 10K webhook events/month

If you're building a subscription app on KMP, I'd love your feedback.

Sample: https://github.com/MobileByteLabs/paycraft-sample-cloud
Docs: https://paycraft.mobilebytesensei.com/docs

---

## Indie Hackers

**Title:** Launched PayCraft v2.0 — RevenueCat alternative for KMP devs

I just shipped the v2.0 release of PayCraft, a subscription billing platform for
Kotlin Multiplatform apps.

**The problem I'm solving:** KMP devs using Stripe have to hard-code payment link URLs
in their app. Every price change requires a new build → App Store review. This is the
KMP equivalent of "no billing SDK exists that works across Android + iOS + Desktop + Web."

**The solution:** PayCraft acts as a thin layer between your app and your payment providers.
Your app calls one SDK method. All product/pricing/paywall configuration lives in a
dashboard you can edit anytime.

**Traction:** 3 internal apps using it in production. Launching publicly today.

**Free tier:** 100 subscribers + 10K webhook events/month. Good for early-stage apps.

AMA!

---

## r/Kotlin + r/androiddev

**Title:** I built a RevenueCat-style billing SDK for KMP — launching today as PayCraft v2.0

Quick overview: PayCraft is a subscription billing library for Kotlin Multiplatform.
Integration is 2 lines:

```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
PayCraftPaywall()
```

Products, pricing, and paywall design are configured in a web dashboard — no app update
required to change prices or switch providers.

Supports 10 providers (Stripe, Razorpay, Paddle + more). Free tier for up to 100 subscribers.

Sample repo: https://github.com/MobileByteLabs/paycraft-sample-cloud
Docs: https://paycraft.mobilebytesensei.com/docs

Happy to discuss the KMP billing problem space or the implementation!
