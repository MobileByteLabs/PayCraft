package com.mobilebytelabs.paycraft.presentation

import androidx.compose.runtime.Composable
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.templates.DarkTemplate
import com.mobilebytelabs.paycraft.presentation.templates.MinimalTemplate
import com.mobilebytelabs.paycraft.presentation.templates.PremiumTemplate

/**
 * One of three pre-built paywall surfaces shipped with PayCraft v2.
 *
 * Each template covers all 6 [BillingState] cases distinctly (AC-5) and references
 * [MobileByteSenseiTheme] for colors so cloud `theme_jsonb` overrides flow through
 * (AC-8). The dashboard's Paywall Designer (sub-plan 08) writes one of these enum
 * values to `tenant_paywall.template`; the SDK resolves via [parse].
 */
enum class PaywallTemplate {
    MINIMAL,
    PREMIUM,
    DARK;

    @Composable
    fun render(
        state: BillingState,
        products: List<Product>,
        onPickProduct: (Product) -> Unit,
        onRetry: () -> Unit,
    ) {
        when (this) {
            MINIMAL -> MinimalTemplate(state, products, onPickProduct, onRetry)
            PREMIUM -> PremiumTemplate(state, products, onPickProduct, onRetry)
            DARK -> DarkTemplate(state, products, onPickProduct, onRetry)
        }
    }

    companion object {
        /** Parses a cloud-provided template name; falls back to [MINIMAL] on unknown. */
        fun parse(s: String): PaywallTemplate = when (s.lowercase()) {
            "minimal" -> MINIMAL
            "premium" -> PREMIUM
            "dark" -> DARK
            else -> MINIMAL
        }
    }
}
