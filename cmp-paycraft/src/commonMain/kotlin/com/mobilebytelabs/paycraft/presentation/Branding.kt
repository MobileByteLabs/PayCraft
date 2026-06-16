package com.mobilebytelabs.paycraft.presentation

import androidx.compose.runtime.Composable

/**
 * Branding tier for the paywall footer.
 *
 * The cloud overrides this to [Attribution] for Free-tier tenants.
 * Pro+ tenants may set [None] to remove the footer entirely.
 * Enterprise tenants may supply a [Custom] composable footer.
 */
sealed interface Branding {
    /** "Powered by PayCraft by MobileByteSensei" — shown on Free-tier tenants. */
    data object Attribution : Branding

    /** Footer hidden entirely — Pro+ tier. */
    data object None : Branding

    /**
     * Enterprise: footer composable supplied by the dashboard custom_footer text
     * (rendered as a [Text]) or by the host app passing its own composable.
     */
    data class Custom(val footer: @Composable () -> Unit) : Branding

    companion object {
        fun parse(s: String): Branding = when (s.lowercase()) {
            "attribution" -> Attribution
            "none" -> None
            // "custom" value from server carries a separate custom_footer text field;
            // the SDK upgrades to Custom only when that field is non-null (caller's responsibility).
            "custom" -> Attribution
            else -> Attribution
        }
    }
}
