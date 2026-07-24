package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * The Google-Play-compliance routing decision (Payments policy). This is the single point that
 * decides whether an Android digital checkout goes through Google Play Billing or falls back to a
 * web payment page — the exact decision that got a consumer app flagged when it opened Stripe.
 *
 * The three enforced cases (VERIFY): Android+digital+playProductId → native; a non-Android
 * platform → web (openUrl); Android+digital with a missing playProductId → BLOCKED (no web
 * fallback, error). Plus: an Android PHYSICAL good is still allowed the web lane.
 */
class CheckoutRoutingTest {

    private fun plan(playProductId: String? = "paycraft_monthly", isDigital: Boolean = true) = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$9.99",
        interval = "month",
        rank = 0,
        playProductId = playProductId,
        isDigital = isDigital,
    )

    @Test
    fun androidDigitalWithPlayProductId_routesToNativePlay() {
        val lane = resolveCheckoutLane(platform = "android", plan = plan(playProductId = "paycraft_monthly"))
        val native = assertIs<CheckoutLane.NativePlay>(lane)
        assertEquals("paycraft_monthly", native.productId)
    }

    @Test
    fun webPlatform_routesToWebCheckout() {
        // A non-Android platform keeps the existing web payment link (openUrl path).
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "web", plan = plan()))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "desktop", plan = plan()))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "ios", plan = plan()))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "macos", plan = plan()))
    }

    @Test
    fun androidDigitalWithMissingPlayProductId_isBlockedNotWeb() {
        // ANTI-STEERING: a misconfigured product must NOT fall back to the browser on Android.
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = null)))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = "")))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = "   ")))
    }

    @Test
    fun androidPhysicalGood_isAllowedWebLane() {
        // A genuinely physical product is permitted the external payment page even on Android.
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("android", plan(isDigital = false)))
    }

    @Test
    fun platformMatchIsCaseInsensitive() {
        assertIs<CheckoutLane.NativePlay>(resolveCheckoutLane("Android", plan()))
    }
}
