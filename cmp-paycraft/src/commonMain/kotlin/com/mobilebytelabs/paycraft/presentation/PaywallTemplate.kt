package com.mobilebytelabs.paycraft.presentation

import androidx.compose.runtime.Composable
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.templates.BrandedStackTemplate
import com.mobilebytelabs.paycraft.presentation.templates.DarkTemplate
import com.mobilebytelabs.paycraft.presentation.templates.MinimalTemplate
import com.mobilebytelabs.paycraft.presentation.templates.PremiumTemplate

/**
 * One of the pre-built paywall surfaces shipped with PayCraft.
 *
 * Each template covers all 6 [BillingState] cases distinctly and reads design
 * tokens from `PayCraftTheme.colors` / `.typography` / `.shape` so cloud
 * `tenant_paywall.primary_color` + `font_family` + `theme_jsonb` overrides
 * flow through. The dashboard's Paywall Designer writes one of these enum
 * values to `tenant_paywall.template`; the SDK resolves via [parse].
 *
 * As of cmp-paycraft 2.1.0, [BRANDED_STACK] is the **production-grade
 * default** — matches the dashboard LIVE PREVIEW design and consumes every
 * v2 `PaywallDto` content field (hero copy, value props, popular_plan_sku,
 * terms/privacy URLs, etc.). The legacy [MINIMAL] / [PREMIUM] / [DARK] enum
 * values are kept for backward compatibility during a 90-day grace and
 * marked `@Deprecated`; they will be removed in cmp-paycraft 3.0.0.
 */
enum class PaywallTemplate {
    /**
     * Production-grade default. Hero icon + title + subtitle + rich-triple
     * value-prop list + plan stack with MOST POPULAR ring on `popular_plan_sku`
     * + branded CTA + terms/privacy/restore micro-footer + tier-aware
     * "Powered by PayCraft" branding. See [BrandedStackTemplate].
     */
    BRANDED_STACK,

    @Deprecated(
        message = "Use BRANDED_STACK — minimal will be removed in cmp-paycraft 3.0.0",
        level = DeprecationLevel.WARNING,
    )
    MINIMAL,

    @Deprecated(
        message = "Use BRANDED_STACK — premium will be removed in cmp-paycraft 3.0.0",
        level = DeprecationLevel.WARNING,
    )
    PREMIUM,

    @Deprecated(
        message = "Use BRANDED_STACK — dark will be removed in cmp-paycraft 3.0.0",
        level = DeprecationLevel.WARNING,
    )
    DARK,
    ;

    @Composable
    fun render(state: BillingState, products: List<Product>, onPickProduct: (Product) -> Unit, onRetry: () -> Unit) {
        when (this) {
            BRANDED_STACK -> BrandedStackTemplate(state, products, onPickProduct, onRetry)
            @Suppress("DEPRECATION")
            MINIMAL -> MinimalTemplate(state, products, onPickProduct, onRetry)
            @Suppress("DEPRECATION")
            PREMIUM -> PremiumTemplate(state, products, onPickProduct, onRetry)
            @Suppress("DEPRECATION")
            DARK -> DarkTemplate(state, products, onPickProduct, onRetry)
        }
    }

    companion object {
        /**
         * Parses a cloud-provided template name. Unknown values fall back to
         * [BRANDED_STACK] (the production-grade default for v2 onwards).
         */
        @Suppress("DEPRECATION")
        fun parse(s: String): PaywallTemplate = when (s.lowercase()) {
            "branded-stack", "brandedstack", "branded_stack" -> BRANDED_STACK
            "minimal" -> MINIMAL
            "premium" -> PREMIUM
            "dark" -> DARK
            else -> BRANDED_STACK
        }
    }
}
