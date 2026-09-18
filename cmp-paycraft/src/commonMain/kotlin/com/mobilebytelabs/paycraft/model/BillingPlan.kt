package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.billing.NativeProductType

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
    /**
     * The merchant-facing SKU (`cappy_plus_annual`), which is the key every per-product provider
     * map is stored under — payment links included (`livePaymentLinksBySku`).
     *
     * It exists because [id] means different things on different paths: the cloud-config builder
     * set `id = dto.sku`, while the paywall's own builder set `id` to the product UUID. Checkout
     * looked up `bySku[plan.id]`, so a plan built by the paywall missed EVERY payment link and the
     * error told the merchant to add a link that was already there. Keying on a field that can only
     * ever hold a sku removes the ambiguity rather than relying on both builders agreeing.
     *
     * Defaults to [id] so existing callers — including the builder where `id` genuinely is the sku —
     * keep working unchanged.
     */
    val sku: String = id,
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
    /**
     * The provider this plan transacts with on THIS platform, and the id to use — resolved
     * server-side from the dashboard's Platform-providers setting and carried through
     * [com.mobilebytelabs.paycraft.config.ProductDto.storeBinding].
     *
     * `null` means the platform has no usable provider for this product, which BLOCKS checkout —
     * never a silent web fallback for a digital good (Payments-policy anti-steering).
     */
    val storeBinding: com.mobilebytelabs.paycraft.config.StoreBinding? = null,
    /**
     * `true` for a digital good (subscription / lifetime unlock consumed in-app) — the case Google
     * Play Billing is MANDATORY for on Android. `false` only for a genuinely physical product that
     * is permitted to use an external payment page. All current PayCraft products are digital, so
     * this defaults to `true`.
     */
    val isDigital: Boolean = true,
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

    /**
     * Which store product type this plan is bought as.
     *
     * Derived from [interval]: the paywall maps `Product.Lifetime` to the literal `"lifetime"`
     * interval, everything else is a recurring subscription. Play needs this BEFORE it will look a
     * product up (`SUBS` vs `INAPP`), and the SDK hardcoded `SUBS` everywhere — so a lifetime plan
     * rendered on the paywall, was tappable, and failed with "Product not found on Play".
     */
    val nativeProductType: NativeProductType
        get() = if (interval.equals("lifetime", ignoreCase = true)) {
            NativeProductType.ONE_TIME
        } else {
            NativeProductType.SUBSCRIPTION
        }
}
