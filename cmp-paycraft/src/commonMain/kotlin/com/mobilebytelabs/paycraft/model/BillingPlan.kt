package com.mobilebytelabs.paycraft.model

/**
 * UI-facing plan model derived from a cloud-resolved [com.mobilebytelabs.paycraft.config.ProductDto].
 *
 * @property price          The price the customer actually pays. When a promotional
 *                          discount or applied coupon is in effect this is the
 *                          POST-discount amount — callers don't need to do math.
 * @property originalPrice  The pre-discount amount, formatted in the same currency
 *                          as [price]. `null` when no discount is active. The paywall
 *                          renders it strike-through above [price] when present.
 * @property discountPercent The active discount percentage (1..99). `null` when no
 *                          discount applies. Drives the "X% OFF" badge.
 * @property discountEndsAt ISO-8601 timestamp when the discount expires.
 *                          `null` = no expiry. The paywall uses this for a countdown.
 * @property trialDays      Free-trial length in days, or `null` if no trial.
 */
data class BillingPlan(
    val id: String,
    val name: String,
    val price: String,
    val interval: String,
    val rank: Int,
    val isPopular: Boolean = false,
    val trialDays: Int? = null,
    val originalPrice: String? = null,
    val discountPercent: Int? = null,
    val discountEndsAt: String? = null,
    /**
     * ISO-4217 currency code that [price] is denominated in (e.g. "USD", "INR").
     * Used by the provider adapter to pick the right per-locale payment link from
     * the nested `{sku: {currency: url}}` shape stored on the provider.
     * Defaults to `"USD"` for legacy callers; cloud config always populates this.
     */
    val currency: String = "USD",
) {
    init {
        require(trialDays == null || trialDays >= 1) {
            "trialDays must be null (no trial offered) or >= 1; got $trialDays. Use null to disable."
        }
        require(discountPercent == null || (discountPercent in 1..99)) {
            "discountPercent must be null or in 1..99; got $discountPercent"
        }
    }

    /** True when the customer should see strike-through pricing on this plan. */
    val hasActiveDiscount: Boolean
        get() = originalPrice != null && discountPercent != null
}
