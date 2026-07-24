package com.mobilebytelabs.paycraft.sample

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.ComposeUIViewController
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import kotlinx.coroutines.runBlocking
import org.koin.core.context.startKoin
import platform.Foundation.NSProcessInfo
import platform.Foundation.NSUserDefaults
import platform.UIKit.UIViewController

/**
 * iOS entry point for the PayCraft sample-app (E6 device-verify, sub-plan 06, AC8).
 *
 * This is the iOS sibling of Android's [SampleApplication] (Koin + PayCraft.initialize) +
 * [MainActivity] (launch-arg seeding harness + testTag exposure) collapsed into one Kotlin
 * function that the SwiftUI/UIKit wrapper under `sample-app/iosApp/` calls at startup:
 *
 * ```swift
 * import SampleApp
 * let vc = IosAppKt.SampleAppViewController()
 * ```
 *
 * It:
 *  1. Starts Koin with [PayCraftModule] once (default `WebCheckoutNativeBillingClient` binding —
 *     the maestro flows exercise the Mock backend + cache seeding, not a real StoreKit purchase,
 *     so the StoreKit2 shim is NOT required for these flows to run).
 *  2. Calls `PayCraft.initialize(apiKey, backend = Mock(sampleSuiteConfig))` — the exact one-line
 *     boot a production consumer performs.
 *  3. Mirrors [MainActivity.maybeSeedEntitlementFromLaunchArgs]: reads `paycraft_provider` +
 *     `paycraft_user_id` from the iOS launch arguments maestro passes and seeds a provider-specific
 *     reconciled Premium into the REAL PayCraftStore cache, so the first composition reads it back
 *     through the genuine cache-first path (applyCachedStatus -> BillingState.Premium, D6/D8).
 *  4. Returns a [ComposeUIViewController] wrapping [App]. Compose Multiplatform maps
 *     `Modifier.testTag` to the iOS accessibility identifier, which is exactly what maestro's `id:`
 *     selector matches on iOS (the Android `testTagsAsResourceId` shim is not needed here).
 */

private var bootstrapped = false

fun SampleAppViewController(): UIViewController {
    bootstrapPayCraft()
    return ComposeUIViewController(
        configure = {
            // The generated Info.plist for this minimal test wrapper does not carry the
            // high-refresh-rate `CADisableMinimumFrameDurationOnPhone` key; relax the strict
            // sanity check so the harness boots (performance is irrelevant for E2E assertions).
            enforceStrictPlistSanityCheck = false
        },
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            App()
        }
    }
}

private fun bootstrapPayCraft() {
    if (bootstrapped) return
    bootstrapped = true

    PayCraft.initialize(
        apiKey = "pk_test_sample",
        backend = PayCraftBackend.Mock(staticConfig = sampleSuiteConfig()),
    )

    val koinApp = startKoin {
        modules(PayCraftModule)
    }

    maybeSeedEntitlementFromLaunchArgs(koinApp.koin.get())
}

private fun maybeSeedEntitlementFromLaunchArgs(store: PayCraftStore) {
    val provider = readLaunchArg("paycraft_provider") ?: return
    val userId = readLaunchArg("paycraft_user_id") ?: "e2e-$provider-01"
    // Email must be present too, or PayCraftBillingManager.init's async branch overwrites the
    // cached Premium with Free (no-saved-email -> Free) — same invariant as MainActivity.
    runBlocking { store.saveEmail(userId) }
    store.cacheSubscriptionStatus(
        SubscriptionStatus(
            isPremium = true,
            plan = "yearly",
            email = userId,
            provider = provider,
            expiresAt = "2099-12-31T00:00:00Z",
            willRenew = true,
        ),
    )
}

/**
 * Read a maestro `launchApp: arguments:` value on iOS. Maestro passes launch arguments to the app
 * as `-key value` argv pairs (the standard iOS NSArgumentDomain convention), so
 * `NSUserDefaults.standardUserDefaults.stringForKey(key)` resolves them. We also scan
 * `NSProcessInfo.arguments` directly (matching both `key` and `-key` forms) as a robust fallback.
 */
private fun readLaunchArg(key: String): String? {
    NSUserDefaults.standardUserDefaults.stringForKey(key)?.let { if (it.isNotBlank()) return it }

    val args = NSProcessInfo.processInfo.arguments
    for (i in args.indices) {
        val token = args[i] as? String ?: continue
        if (token == key || token == "-$key" || token == "--$key") {
            val next = args.getOrNull(i + 1) as? String
            if (next != null && !next.startsWith("-")) return next
        }
        // `-key=value` / `key=value` single-token form
        val prefix = "$key="
        val dashPrefix = "-$key="
        when {
            token.startsWith(dashPrefix) -> return token.substring(dashPrefix.length)
            token.startsWith(prefix) -> return token.substring(prefix.length)
        }
    }
    return null
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
