package com.mobilebytelabs.paycraft.presentation

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.model.Product

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

    // `render()` lived here and dispatched to four Kotlin templates. It is gone: those templates
    // were one state machine (now PaywallStateHost) plus four layouts (now seed trees, resolved by
    // BuiltInPaywallSeeds). The enum remains because it still answers a real question — WHICH seed a
    // tenant starts from — which is the "seed selection" role the plan reserved for it.

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
