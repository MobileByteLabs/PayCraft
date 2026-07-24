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

        PayCraft.initialize(
            apiKey = "pk_test_sample",
            backend = PayCraftBackend.Mock(staticConfig = sampleSuiteConfig()),
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
            template = "minimal",
            branding = "attribution",
            supportEmail = "support@yourdomain.com",
        ),
    )
}
