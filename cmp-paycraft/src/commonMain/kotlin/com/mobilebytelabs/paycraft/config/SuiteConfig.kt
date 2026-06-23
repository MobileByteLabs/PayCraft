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
    /**
     * Nested per-(sku, currency) payment-link map — `{sku: {currency: url}}`.
     * Multi-product apps populate this; the SDK looks up
     * `testPaymentLinksBySku[plan.id]?[plan.currency]` first.
     * Server stores this shape in `tenant_providers.test_payment_links` JSONB.
     */
    @SerialName("test_payment_links")
    val testPaymentLinksBySku: Map<String, Map<String, String>> = emptyMap(),
    /**
     * Nested per-(sku, currency) payment-link map for live mode.
     * See [testPaymentLinksBySku].
     */
    @SerialName("live_payment_links")
    val livePaymentLinksBySku: Map<String, Map<String, String>> = emptyMap(),
    @SerialName("supported_locales") val supportedLocales: List<String>? = null,
)

/**
 * Single bullet in the paywall's value-prop list, rendered by `ValuePropList` as
 * an icon-leading row under the hero subtitle. Server stores rich triples in
 * `tenant_paywall.value_props` JSONB; SDK deserializes them here.
 *
 * `icon` is a string key from a curated vocabulary (`ad-free`, `hd`, `unlimited`,
 * `priority`, `early`, `wifi`, `lock`, `star`, `heart`). Unknown keys fall back
 * to a generic check icon in the SDK render.
 */
@Serializable
data class ValuePropTriple(val icon: String, val title: String, val description: String? = null)

@Serializable
data class PaywallDto(
    // ── v1 (migration 030 baseline) ──────────────────────────────────────
    val template: String = "branded-stack",
    @SerialName("theme_jsonb") val themeJsonb: Map<String, String> = emptyMap(),
    val branding: String = "attribution",
    @SerialName("custom_footer") val customFooter: String? = null,
    @SerialName("primary_color") val primaryColor: String? = null,
    @SerialName("font_family") val fontFamily: String? = null,
    // ── v2 (migration 071, cmp-paycraft 2.1.0+) ─────────────────────────
    /** Hero title rendered above the plan stack (default: "Upgrade to Premium"). */
    @SerialName("hero_title") val heroTitle: String = "Upgrade to Premium",
    /** Sub-headline under the hero title (matches reels-downloader strings.xml default). */
    @SerialName("hero_subtitle")
    val heroSubtitle: String = "Enjoy ad-free experience, HD downloads, and exclusive features",
    /** Rich-triple bullet list rendered between hero subtitle and plan stack. Empty → list hidden. */
    @SerialName("value_props") val valueProps: List<ValuePropTriple> = emptyList(),
    /** Continue button label on the paywall (default: "Continue"). */
    @SerialName("cta_continue") val ctaContinue: String = "Continue",
    /** Get-premium button label on the Settings-tab banner (default: "Get Premium"). */
    @SerialName("cta_get_premium") val ctaGetPremium: String = "Get Premium",
    /** Restore-purchase link label (default: "Restore Your Premium"). */
    @SerialName("restore_label") val restoreLabel: String = "Restore Your Premium",
    /** Terms-of-service URL; null → no terms link in footer. */
    @SerialName("terms_url") val termsUrl: String? = null,
    /** Privacy-policy URL; null → no privacy link in footer. */
    @SerialName("privacy_url") val privacyUrl: String? = null,
    /** SKU of the plan card that renders the MOST POPULAR ring; null → no ring. */
    @SerialName("popular_plan_sku") val popularPlanSku: String? = null,
    /** Post-purchase celebration sheet title (PayCraftCheckoutSuccessSheet). */
    @SerialName("success_title") val successTitle: String = "Welcome to Premium!",
    /** Post-purchase celebration sheet message body. */
    @SerialName("success_message")
    val successMessage: String = "You now have access to all premium features.",
    /** Post-purchase celebration sheet CTA label. */
    @SerialName("success_cta_label") val successCtaLabel: String = "Continue to app",
    /** Inline SVG path data for the hero icon. Sanitized server-side. */
    @SerialName("hero_icon_svg") val heroIconSvg: String? = null,
    /**
     * PNG fallback URL for the hero icon. **Reserved for cmp-paycraft 2.2.0+** —
     * 2.1.0 reads inline SVG only; this field is persisted but not consumed yet.
     */
    @SerialName("hero_icon_url") val heroIconUrl: String? = null,
    @SerialName("support_email") val supportEmail: String? = null,
)

/**
 * Effective theme-override map consumed by `PayCraftThemeProvider(themeOverride = …)`.
 *
 * Merges the legacy [PaywallDto.themeJsonb] map with the dedicated [PaywallDto.primaryColor]
 * column. The dashboard Paywall designer writes the brand color into `primary_color`
 * (its own column), NOT into `theme_jsonb` — so without this merge the dashboard's
 * primary color silently drops and the paywall inherits the host app's MaterialTheme
 * primary (e.g. reels-downloader's blue) instead of the configured brand color.
 *
 * `primary_color` is authoritative: it overrides any legacy `theme_jsonb["primary"]`.
 */
val PaywallDto.effectiveThemeOverride: Map<String, String>
    get() = buildMap {
        putAll(themeJsonb)
        primaryColor?.takeIf { it.isNotBlank() }?.let { put("primary", it) }
    }
