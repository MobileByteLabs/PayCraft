import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "SDK integration modes — PayCraft",
  description: "Two ways to integrate PayCraft: the drop-in themed paywall, or the headless billing API with your own UI.",
}

export default function SdkIntegrationPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 prose prose-slate">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold not-prose">Documentation</p>
      <h1>Two ways to integrate</h1>
      <p className="lead">
        PayCraft exposes the same billing engine two ways. Use the drop-in paywall for a
        polished UI in a few lines, or go headless and render your own.
      </p>

      <h2>Setup (both modes)</h2>
      <pre><code>{`// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-paycraft:LATEST")

// App startup — Application.kt / MainActivity.kt / AppDelegate
PayCraft.initialize(apiKey = "pk_live_YOUR_KEY_HERE")`}</code></pre>

      <h2>Mode 1 — Drop-in paywall (themed)</h2>
      <p>
        Three lines. The paywall <strong>inherits your app&apos;s theme</strong> — place it inside your
        <code>MaterialTheme</code> and it renders with your colors, shapes, and typography (any brand
        overrides you set in the dashboard layer on top). Products, prices, trials, and copy all come
        from the dashboard.
      </p>
      <pre><code>{`@Composable
fun Screen() {
    var showPaywall by remember { mutableStateOf(false) }

    MaterialTheme(colorScheme = YourAppColorScheme) {   // ← paywall uses YOUR theme
        // …your UI…
        if (showPaywall) {
            PayCraftPaywall(onDismiss = { showPaywall = false })
        }
    }
}`}</code></pre>
      <p>
        That&apos;s the whole integration — plan selection, checkout routing (Google Play / App Store /
        Stripe / Razorpay), trials, coupons, and restore are handled for you.
      </p>

      <h2>Mode 2 — Headless (your own UI)</h2>
      <p>
        Want full control of the UI? Observe the billing state and drive checkout yourself. No PayCraft
        composables required.
      </p>
      <pre><code>{`@Composable
fun Upgrade() {
    val billing = PayCraft.billingManager ?: return
    val state by billing.billingState.collectAsState()
    val plans by PayCraft.suiteConfigFlow.collectAsState()

    when (state) {
        is BillingState.Premium -> PremiumContent()
        is BillingState.Loading -> YourShimmer()
        else -> Column {
            plans?.products?.forEach { plan ->
                YourPlanRow(plan) {
                    PayCraft.checkout(plan.toBillingPlan())   // routes to the right provider
                }
            }
        }
    }
}`}</code></pre>
      <p>Useful headless signals:</p>
      <ul>
        <li><code>PayCraft.billingManager?.billingState</code> — Free / Premium / Loading / DeviceConflict</li>
        <li><code>PayCraft.billingManager?.isPremium</code> · <code>?.isInTrial</code> · <code>?.trialEndsAt</code></li>
        <li><code>PayCraft.checkout(plan, email?)</code> — starts checkout on the correct provider for the platform</li>
        <li><code>PayCraft.applyCoupon(planId, code)</code> — validate + apply a promo code</li>
        <li><code>PayCraft.billingManager?.refreshStatus(force = true)</code> — force a re-check</li>
      </ul>

      <h2>Which should I use?</h2>
      <ul>
        <li><strong>Drop-in</strong> — fastest, store-compliant, always up to date with the dashboard. Recommended.</li>
        <li><strong>Headless</strong> — when your paywall is bespoke or embedded in a larger flow.</li>
      </ul>
      <p>
        Both stay in sync with the dashboard in realtime — change a price, trial, or discount and the
        app reflects it without a rebuild.
      </p>
    </main>
  )
}
