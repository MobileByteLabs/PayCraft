package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.config.StoreBinding
import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * The Google-Play-compliance routing decision (Payments policy). This is the single point that
 * decides whether an Android digital checkout goes through Google Play Billing or falls back to a
 * web payment page — the exact decision that got a consumer app flagged when it opened Stripe.
 *
 * The enforced cases (VERIFY): Android+digital+playProductId → Google Play native; iOS/macOS+
 * digital+appStoreProductId → StoreKit native (Apple Guideline 3.1.1); web/desktop → web (openUrl);
 * a native-store digital good with a missing product id → BLOCKED (no web fallback, error). Plus: a
 * PHYSICAL good is still allowed the web lane on every platform.
 */
class CheckoutRoutingTest {

    private fun plan(
        binding: StoreBinding? = StoreBinding("google_play", "paycraft_monthly"),
        isDigital: Boolean = true,
    ) = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$9.99",
        interval = "month",
        rank = 0,
        storeBinding = binding,
        isDigital = isDigital,
    )

    // The lane now follows the SERVER-RESOLVED provider, not the platform. These tests changed
    // shape deliberately: they used to assert "android => Play, ios => StoreKit" as a hardcoded
    // client rule, which made the dashboard's Platform-providers setting decorative — a tenant who
    // chose Stripe for iOS still got StoreKit. The binding is resolved once by /config from
    // tenant_routing_rules and honoured here.

    @Test
    fun bindingGooglePlay_routesToNativePlay() {
        val lane = resolveCheckoutLane("android", plan(StoreBinding("google_play", "paycraft_monthly")))
        assertEquals("paycraft_monthly", assertIs<CheckoutLane.NativePlay>(lane).productId)
    }

    @Test
    fun bindingAppStore_routesToNativeStoreKit() {
        val lane = resolveCheckoutLane("ios", plan(StoreBinding("app_store", "com.paycraft.monthly")))
        assertEquals("com.paycraft.monthly", assertIs<CheckoutLane.NativeStoreKit>(lane).productId)
    }

    @Test
    fun bindingIsHonouredOverThePlatformDefault() {
        // The whole point of the change: a tenant may put a WEB provider on a native platform, and
        // the SDK must obey rather than force the store. Previously impossible to express.
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("ios", plan(StoreBinding("stripe_card", "price_123"))))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("android", plan(StoreBinding("stripe_card", "price_123"))))
        // …and a native store on either platform routes natively, whichever platform asked.
        assertIs<CheckoutLane.NativePlay>(resolveCheckoutLane("android", plan(StoreBinding("google_play", "x"))))
        assertIs<CheckoutLane.NativeStoreKit>(resolveCheckoutLane("ios", plan(StoreBinding("app_store", "y"))))
    }

    @Test
    fun digitalWithNoBinding_isBlockedNotWeb() {
        // ANTI-STEERING (Apple 3.1.1 / Google Payments): an unresolvable product must NOT fall back
        // to the browser. No binding means the tenant configured no provider for this platform.
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("ios", plan(binding = null)))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(binding = null)))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("macos", plan(binding = null)))
    }

    @Test
    fun physicalGood_isAllowedWebLane() {
        // A genuinely physical product is permitted the external payment page on every platform.
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("android", plan(isDigital = false)))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("ios", plan(isDigital = false)))
    }

    @Test
    fun unknownProviderFallsToWeb() {
        // Any PSP that is not a native store transacts through the web lane with its price id.
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("web", plan(StoreBinding("razorpay_upi", "plan_9"))))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("desktop", plan(StoreBinding("cashfree", "cf_1"))))
    }
}
