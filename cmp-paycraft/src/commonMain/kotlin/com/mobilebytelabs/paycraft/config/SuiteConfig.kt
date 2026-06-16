package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Cloud-resolved configuration snapshot for a single tenant.
 *
 * Fetched from `GET /functions/v1/config?apiKey=…` and cached locally via [ConfigCache].
 * All product/pricing/provider/paywall decisions made in the dashboard arrive here.
 */
@Serializable
data class SuiteConfig(
    @SerialName("tenant_id") val tenantId: String,
    val plan: String? = null,
    val products: List<ProductDto> = emptyList(),
    val providers: List<ProviderDto> = emptyList(),
    val paywall: PaywallDto = PaywallDto(),
    val locale: String = "US",
    @SerialName("cache_ttl_seconds") val cacheTtlSeconds: Int = 3600,
    // Set by the client on receipt; not returned by the server.
    @SerialName("fetched_at_epoch_millis") val fetchedAtEpochMillis: Long = 0L,
)

@Serializable
data class ProductDto(
    val id: String,
    val sku: String,
    val type: String, // "subscription" | "trial" | "lifetime"
    @SerialName("display_name") val displayName: String,
    @SerialName("trial_enabled") val trialEnabled: Boolean = true,
    @SerialName("trial_duration_days") val trialDurationDays: Int? = 7,
    @SerialName("attaches_to_product_id") val attachesToProductId: String? = null,
    val interval: String? = null, // "month" | "quarter" | "semiannual" | "year"
    @SerialName("base_price_cents") val basePriceCents: Int = 0,
    @SerialName("base_currency") val baseCurrency: String = "USD",
    @SerialName("display_order") val displayOrder: Int = 0,
    val active: Boolean = true,
    @SerialName("resolved_price") val resolvedPrice: PriceDto? = null,
    /**
     * Automatic percentage discount, 1..99. When set, the SDK paywall renders the
     * `base_price_cents` (and each per-locale price in `tenant_pricing`) with a
     * strike-through original and a discounted final amount. NULL = no discount.
     *
     * Applied automatically on checkout (Stripe Coupon attached) — the customer
     * does NOT type a code. For code-driven discounts use [CouponDto] instead.
     */
    @SerialName("discount_percent") val discountPercent: Int? = null,
    /** ISO 8601 timestamp when the auto-discount expires. NULL = no expiry. */
    @SerialName("discount_ends_at") val discountEndsAt: String? = null,
)

/**
 * A code-driven discount the customer enters at checkout. The dashboard creates
 * these per-tenant via the Coupons page; the SDK exposes `PayCraft.applyCoupon()`
 * to validate one before kicking off checkout.
 *
 * `duration` mirrors Stripe's Coupon model:
 *   - `"once"`      — discount applied to first invoice only
 *   - `"repeating"` — applied for `durationInMonths` invoices, then drops off
 *   - `"forever"`   — applied to every invoice indefinitely
 *
 * The recurring subscription is created normally — Stripe attaches the coupon
 * to the subscription record, so renewals continue automatically with the
 * coupon's duration policy applied. The SDK does NOT need to re-validate the
 * coupon on each renewal; Stripe is the single source of truth.
 */
@Serializable
data class CouponDto(
    val id: String,
    val code: String,
    val name: String? = null,
    @SerialName("percent_off") val percentOff: Int,
    val duration: String, // "once" | "repeating" | "forever"
    @SerialName("duration_in_months") val durationInMonths: Int? = null,
    @SerialName("redeem_by") val redeemBy: String? = null,
)

@Serializable
data class PriceDto(@SerialName("amount_cents") val amountCents: Int, val currency: String, val source: String)

@Serializable
data class ProviderDto(
    val provider: String,
    @SerialName("test_payment_links") val testPaymentLinks: Map<String, String> = emptyMap(),
    @SerialName("live_payment_links") val livePaymentLinks: Map<String, String> = emptyMap(),
    @SerialName("supported_locales") val supportedLocales: List<String>? = null,
)

@Serializable
data class PaywallDto(
    val template: String = "minimal",
    @SerialName("theme_jsonb") val themeJsonb: Map<String, String> = emptyMap(),
    val branding: String = "attribution",
    @SerialName("custom_footer") val customFooter: String? = null,
    @SerialName("primary_color") val primaryColor: String? = null,
    @SerialName("font_family") val fontFamily: String? = null,
    @SerialName("support_email") val supportEmail: String? = null,
)
