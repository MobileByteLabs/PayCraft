# PayCraft Sample — Cloud

> Three lines. Subscription billing across Android / iOS / Desktop / Web.

```kotlin
// 1. Initialize (once, at app start)
PayCraft.initialize(apiKey = "pk_live_…")

// 2. Show the paywall anywhere
PayCraftPaywall()
```

Everything else — products, prices, paywall template, branding, providers — is configured
in the [PayCraft Dashboard](https://paycraft.mobilebytesensei.com). Change it anytime without a new release.

---

## Try it

1. **Clone:**
   ```bash
   git clone https://github.com/MobileByteLabs/paycraft-sample-cloud
   cd paycraft-sample-cloud
   ```

2. **Get an API key** at [paycraft.mobilebytesensei.com](https://paycraft.mobilebytesensei.com) (Free tier — no card required).

3. **Replace the placeholder key** in
   `composeApp/src/androidMain/kotlin/…/MainActivity.kt`:
   ```kotlin
   PayCraft.initialize(apiKey = "pk_live_YOUR_KEY_HERE")
   ```

4. **Run:**
   ```bash
   ./gradlew composeApp:installDebug           # Android
   ./gradlew composeApp:run                    # Desktop JVM
   # iOS — open iosApp/iosApp.xcodeproj in Xcode
   ```

---

## What you get

- **3 paywall templates** — Minimal / Premium / Dark — switch in dashboard, no code change
- **Multi-provider checkout** — bottom sheet with Stripe + Razorpay + additional providers
- **Trial / Subscription / Lifetime** product types
- **Per-country pricing** via Stripe Pricing API
- **Branding tiers** — Attribution (Free) / None (Pro) / Custom (Enterprise)

---

## Add to your own project

```kotlin
// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0")
```

Full docs: [paycraft.mobilebytesensei.com/docs](https://paycraft.mobilebytesensei.com/docs)
