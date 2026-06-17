package com.mobilebytelabs.paycraft.sample

import android.app.Application
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.di.PayCraftModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

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

        startKoin {
            androidContext(this@SampleApplication)
            modules(PayCraftModule)
        }
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
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinks = mapOf(
                    "monthly" to "https://buy.stripe.com/test_sample_monthly",
                    "quarterly" to "https://buy.stripe.com/test_sample_quarterly",
                    "yearly" to "https://buy.stripe.com/test_sample_yearly",
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
