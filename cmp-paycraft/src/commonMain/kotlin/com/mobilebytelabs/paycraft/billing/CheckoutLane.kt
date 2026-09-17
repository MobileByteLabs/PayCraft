package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * The store-compliance checkout routing decision (RULE: Payments policy — both stores).
 *
 * A digital subscription bought inside a NATIVE app MUST transact through that store's own in-app
 * billing, never an external web payment page:
 *  - On **Android**, routing the user to an external Stripe/Razorpay web page is the "leads users to
 *    a payment method other than Google Play's billing system" violation that got a consumer app
 *    (Reels Downloader, `com.sensei.social`) flagged and restricted — so Android+digital transacts
 *    through Google Play Billing ([NativePlay]).
 *  - On **iOS/macOS**, the equivalent is **Apple App Store Review Guideline 3.1.1**: apps offering a
 *    digital subscription MUST use Apple's In-App Purchase (StoreKit); steering the user to a web
 *    checkout for the same digital good is a 3.1.1 rejection — so iOS/macOS+digital transacts through
 *    StoreKit ([NativeStoreKit]).
 *
 * This is the single, unit-testable decision point every checkout entry (`PayCraft.checkout` /
 * `checkoutWithProvider`) funnels through, so the browser fallback is structurally unreachable for
 * native digital goods on either store.
 */
sealed interface CheckoutLane {
    /** Android + digital + a configured Play product id → transact via Google Play Billing. */
    data class NativePlay(val productId: String) : CheckoutLane

    /**
     * iOS/macOS + digital + a configured App Store product id → transact via StoreKit in-app
     * purchase (Apple Guideline 3.1.1 — a web checkout for a digital subscription is a rejection).
     */
    data class NativeStoreKit(val productId: String) : CheckoutLane

    /**
     * A genuinely physical product (any platform), OR a digital product on a platform with no native
     * store (web/desktop) → keep the existing web checkout URL.
     */
    data object Web : CheckoutLane

    /**
     * A native-store digital checkout whose product id is not configured (Android+digital with no
     * `play_product_id`, or iOS/macOS+digital with no `app_store_product_id`). The checkout is
     * BLOCKED — we set a billing error and never open the browser (anti-steering keystone: a
     * misconfigured product is NOT a licence to route to the web payment page on a native store).
     */
    data class Misconfigured(val reason: String) : CheckoutLane
}

/**
 * Decide the checkout lane for [plan] from the SERVER-RESOLVED [BillingPlan.storeBinding].
 *
 * The platform no longer picks the store. `/config` reads `tenant_routing_rules` for the requesting
 * platform (via the `x-paycraft-platform` header) and returns the provider that platform's
 * Platform-providers setting names as PRIMARY, together with the id to transact against. This
 * function only honours that decision:
 *
 * - binding provider `google_play` -> [CheckoutLane.NativePlay]
 * - binding provider `app_store` -> [CheckoutLane.NativeStoreKit]
 * - any other provider (`stripe_card`, other PSPs) -> [CheckoutLane.Web]
 * - digital good with NO binding -> [CheckoutLane.Misconfigured] (BLOCKS; never a web fallback,
 *   the anti-steering keystone — a misconfigured product is not a licence to open the browser)
 * - any physical product -> [CheckoutLane.Web]
 *
 * This replaced a hardcoded `platform == "android" -> Play` / `ios -> StoreKit` mapping, which made
 * the dashboard's Platform-providers page decorative: a tenant whose iOS primary was set to Stripe
 * still went to StoreKit, and one whose Android primary was Stripe still went to Play. Routing is
 * now a tenant decision, made once on the server, rather than a client assumption.
 *
 * [platform] is retained for the physical-goods short-circuit and for diagnostics only.
 */
fun resolveCheckoutLane(platform: String, plan: BillingPlan, isDigital: Boolean = plan.isDigital): CheckoutLane {
    if (!isDigital) return CheckoutLane.Web

    val binding = plan.storeBinding
        ?: return CheckoutLane.Misconfigured(
            "no provider configured for platform '$platform' — set a primary provider for this " +
                "platform on the dashboard's Platform providers page, and give the product an id for it",
        )

    return when (binding.provider.lowercase()) {
        "google_play" -> CheckoutLane.NativePlay(binding.productId)
        "app_store" -> CheckoutLane.NativeStoreKit(binding.productId)
        // Every other provider is a web PSP (stripe_card, razorpay, cashfree…). The binding's
        // product id is that PSP's price/plan id; the web lane resolves the checkout URL from it.
        else -> CheckoutLane.Web
    }
}
