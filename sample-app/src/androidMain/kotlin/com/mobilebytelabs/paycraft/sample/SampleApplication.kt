package com.mobilebytelabs.paycraft.sample

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.di.paycraftPlayBillingModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import java.lang.ref.WeakReference

/**
 * PayCraft Sample Application.
 *
 * Production apps call exactly one line:
 *
 * ```kotlin
 * PayCraft.initialize(apiKey = BuildConfig.PAYCRAFT_API_KEY)
 * ```
 *
 * This sample uses [PayCraftBackend.Mock] so the showcase runs offline without a
 * dashboard or network round-trip. Replace with your real `pk_live_…` key from
 * https://paycraft.mobilebytesensei.com to wire up production checkout.
 */
class SampleApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Instrumented tests own this setup themselves: BasePayCraftUiTest calls
        // PayCraft.initialize with a Mock backend and starts Koin with fakes in @Before, then
        // stopKoin()s in @After. If the Application ALSO initialises — especially against a real
        // backend, where init launches a realtime-identity refresh — that background coroutine
        // outlives the test and resolves Koin after the scope closed, failing every test with
        // `ClosedScopeException: Scope '_root_' is closed`. Observed the moment the APK was built
        // with -PpaycraftBaseUrl; a default (Mock) build hid it, because Mock has nothing to refresh.
        if (isRunningUnderInstrumentation()) {
            registerActivityLifecycleCallbacks(ForegroundActivityTracker)
            return
        }

        // Mock by default so the showcase runs offline. Supply -PpaycraftBaseUrl (and a key) at
        // build time to point it at a real PayCraft backend — a local Supabase, a staging stack —
        // which is how a server-authored paywall tree gets verified on an actual device rather
        // than inferred from a JVM render.
        val baseUrl = BuildConfig.PAYCRAFT_BASE_URL
        PayCraft.initialize(
            apiKey = BuildConfig.PAYCRAFT_API_KEY,
            backend =
            if (baseUrl.isNotBlank()) {
                PayCraftBackend.SelfHosted(
                    supabaseUrl = baseUrl,
                    supabaseAnonKey = BuildConfig.PAYCRAFT_ANON_KEY,
                )
            } else {
                PayCraftBackend.Mock(staticConfig = sampleSuiteConfig())
            },
        )

        // Track the foreground Activity so paycraftPlayBillingModule can hand it to
        // Play `launchBillingFlow` (which requires a resumed Activity).
        registerActivityLifecycleCallbacks(ForegroundActivityTracker)

        startKoin {
            androidContext(this@SampleApplication)
            modules(
                PayCraftModule,
                // Payments-policy Play Billing lane: overrides the default WebCheckout no-op with
                // the real PlayBillingNativeClient so Android digital checkout transacts through
                // Google Play Billing. Consumer apps (e.g. Reels Downloader) MUST include this.
                paycraftPlayBillingModule(
                    context = applicationContext,
                    activityProvider = { ForegroundActivityTracker.current() },
                ),
            )
        }
    }

    /**
     * True when the process is hosting an instrumented test.
     *
     * The test APK's classes are loaded into the app's classloader for an instrumented run and are
     * absent otherwise, so the presence of the runner registry is the signal — no build flag to
     * forget to set, and no test-only code shipped in a release.
     */
    private fun isRunningUnderInstrumentation(): Boolean = try {
        Class.forName("androidx.test.platform.app.InstrumentationRegistry")
        true
    } catch (_: ClassNotFoundException) {
        false
    }

    /** Holds a WeakReference to the currently-resumed Activity for the Play billing flow. */
    private object ForegroundActivityTracker : Application.ActivityLifecycleCallbacks {
        private var resumed: WeakReference<Activity>? = null
        fun current(): Activity? = resumed?.get()
        override fun onActivityResumed(activity: Activity) {
            resumed = WeakReference(activity)
        }
        override fun onActivityPaused(activity: Activity) {
            if (resumed?.get() === activity) resumed = null
        }
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    private fun sampleSuiteConfig(): SuiteConfig = SuiteConfig(
        tenantId = "sample-tenant",
        plan = "free",
        products = listOf(
            ProductDto(
                id = "monthly",
                sku = "monthly",
                type = "subscription",
                displayName = "Monthly",
                interval = "month",
                basePriceCents = 9900,
                baseCurrency = "INR",
                displayOrder = 0,
                // Google Play product id — Android digital checkout transacts against this via
                // Google Play Billing (Payments-policy compliance).
                playProductId = "paycraft_monthly",
            ),
            ProductDto(
                id = "quarterly",
                sku = "quarterly",
                type = "subscription",
                displayName = "Quarterly",
                interval = "quarter",
                basePriceCents = 24900,
                baseCurrency = "INR",
                displayOrder = 1,
                playProductId = "paycraft_quarterly",
            ),
            ProductDto(
                id = "yearly",
                sku = "yearly",
                type = "subscription",
                displayName = "Yearly",
                interval = "year",
                basePriceCents = 79900,
                baseCurrency = "INR",
                displayOrder = 2,
                playProductId = "paycraft_yearly",
            ),
            // 14-day free trial attached to the monthly plan — showcases the
            // Play Subscriptions-policy trial disclosure (post-trial price + cadence
            // on the offer, auto-renew + how-to-cancel copy). Mirrors the reels-downloader
            // offer that must clearly state trial terms.
            ProductDto(
                id = "monthly_trial",
                sku = "monthly_trial",
                type = "trial",
                displayName = "14-day Free Trial",
                trialDurationDays = 14,
                attachesToProductId = "monthly",
                displayOrder = 99,
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinksBySku = mapOf(
                    "monthly" to mapOf("INR" to "https://buy.stripe.com/test_sample_monthly"),
                    "quarterly" to mapOf("INR" to "https://buy.stripe.com/test_sample_quarterly"),
                    "yearly" to mapOf("INR" to "https://buy.stripe.com/test_sample_yearly"),
                ),
            ),
        ),
        paywall = PaywallDto(
            template = "branded-stack",
            branding = "attribution",
            popularPlanSku = "quarterly",
            supportEmail = "support@yourdomain.com",
        ),
    )
}
