package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * The Google-Play-compliance checkout routing decision (RULE: Payments policy).
 *
 * A digital subscription bought inside an Android app MUST transact through Google Play Billing —
 * routing the user to an external Stripe/Razorpay web payment page is the "leads users to a payment
 * method other than Google Play's billing system" violation that got a consumer app (Reels
 * Downloader, `com.sensei.social`) flagged and restricted. This is the single, unit-testable
 * decision point every checkout entry (`PayCraft.checkout` / `checkoutWithProvider`) funnels through
 * so the browser fallback is structurally unreachable for Android digital goods.
 */
sealed interface CheckoutLane {
    /** Android + digital + a configured Play product id → transact via Google Play Billing. */
    data class NativePlay(val productId: String) : CheckoutLane

    /** Non-Android platform, OR a genuinely physical product → keep the existing web checkout URL. */
    data object Web : CheckoutLane

    /**
     * Android + digital but no `play_product_id` configured. The checkout is BLOCKED — we set a
     * billing error and never open the browser (anti-steering keystone: a misconfigured product is
     * NOT a licence to route to the web payment page on Android).
     */
    data class Misconfigured(val reason: String) : CheckoutLane
}

/**
 * Decide the checkout lane for [plan] on [platform].
 *
 * - `platform == "android"` + [isDigital] + non-blank [BillingPlan.playProductId] → [CheckoutLane.NativePlay].
 * - `platform == "android"` + [isDigital] + blank/null play product id → [CheckoutLane.Misconfigured]
 *   (BLOCKS — no web fallback).
 * - any non-Android platform (web/desktop/ios/macos) OR a physical product → [CheckoutLane.Web].
 *
 * @param platform one of `PlatformInfo.platform` values: `android | ios | macos | desktop | web`.
 */
fun resolveCheckoutLane(platform: String, plan: BillingPlan, isDigital: Boolean = plan.isDigital): CheckoutLane {
    val isAndroidDigital = platform.equals("android", ignoreCase = true) && isDigital
    if (!isAndroidDigital) return CheckoutLane.Web

    val productId = plan.playProductId
    return if (productId.isNullOrBlank()) {
        CheckoutLane.Misconfigured("Google Play product not configured")
    } else {
        CheckoutLane.NativePlay(productId)
    }
}
