package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.dp

/**
 * PayCraft theme configuration.
 *
 * ### Usage — default (Material3 adaptive)
 * PayCraft UI components read from [LocalPayCraftTheme] automatically. If you
 * don't wrap them in [PayCraftThemeProvider] they fall back to [PayCraftTheme.Default],
 * which reads tonal roles from the host app's [MaterialTheme].
 *
 * ### Usage — custom theme
 * ```kotlin
 * PayCraftThemeProvider(
 *     theme = PayCraftTheme(
 *         colors = PayCraftColors(
 *             accent = Color(0xFF6200EE),
 *             activeBadge = Color(0xFF4CAF50),
 *             // ...
 *         )
 *     )
 * ) {
 *     PayCraftPaywall(onDismiss = { })
 * }
 * ```
 *
 * ### Usage — only override accent
 * ```kotlin
 * PayCraftThemeProvider(
 *     theme = PayCraftTheme.Default.withAccent(Color(0xFFFF6F00))
 * ) { ... }
 * ```
 */
data class PayCraftTheme(
    val colors: PayCraftColors = PayCraftColors.Defaults,
    val typography: PayCraftTypography = PayCraftTypography.Default,
    val shape: PayCraftShape = PayCraftShape.Default,
) {
    companion object {
        /**
         * Adaptive theme that reads tonal color roles from the current [MaterialTheme].
         * Used by all PayCraft components if no explicit theme is provided.
         */
        val Default = PayCraftTheme()

        /** Active [PayCraftTheme.colors] in the current composition. */
        val colors: PayCraftColors
            @Composable
            @ReadOnlyComposable
            get() = LocalPayCraftTheme.current.colors

        /** Active [PayCraftTheme.typography] in the current composition. */
        val typography: PayCraftTypography
            @Composable
            @ReadOnlyComposable
            get() = LocalPayCraftTheme.current.typography

        /** Active [PayCraftTheme.shape] in the current composition. */
        val shape: PayCraftShape
            @Composable
            @ReadOnlyComposable
            get() = LocalPayCraftTheme.current.shape

        /** Full [PayCraftTheme] snapshot for the current composition. */
        val current: PayCraftTheme
            @Composable
            @ReadOnlyComposable
            get() = LocalPayCraftTheme.current

        /**
         * Builds an adaptive [PayCraftTheme] that maps Material3 tonal color roles to
         * PayCraft semantic tokens. Call inside a Composable context.
         */
        @Composable
        @ReadOnlyComposable
        fun materialAdaptive(): PayCraftTheme {
            val mat = MaterialTheme.colorScheme
            return PayCraftTheme(
                colors = PayCraftColors(
                    accent = mat.primary,
                    accentContainer = mat.primaryContainer,
                    onAccentContainer = mat.onPrimaryContainer,
                    activeBadge = mat.tertiary,
                    onActiveBadge = mat.onTertiary,
                    popularBadge = mat.secondary,
                    onPopularBadge = mat.onSecondary,
                    errorContainer = mat.errorContainer,
                    onErrorContainer = mat.onErrorContainer,
                    surface = mat.surface,
                    onSurface = mat.onSurface,
                    onSurfaceVariant = mat.onSurfaceVariant,
                    outline = mat.outlineVariant,
                    divider = mat.outlineVariant.copy(alpha = 0.5f),
                ),
            )
        }
    }

    /**
     * Returns a copy of this theme with the accent color replaced.
     *
     * Convenience for minor tinting without recreating the full [PayCraftColors].
     */
    fun withAccent(accent: androidx.compose.ui.graphics.Color): PayCraftTheme =
        copy(colors = colors.copy(accent = accent))
}

/**
 * Shape overrides for PayCraft surfaces.
 *
 * Defaults mirror Material3 corner radii so components feel native in any Material app.
 */
data class PayCraftShape(
    /** Corner radius for plan cards. */
    val planCard: androidx.compose.ui.unit.Dp = 12.dp,
    /** Corner radius for the premium status card. */
    val statusCard: androidx.compose.ui.unit.Dp = 16.dp,
    /** Corner radius for badge pills (active, popular). */
    val badge: androidx.compose.ui.unit.Dp = 100.dp,
    /** Corner radius for the full paywall scaffold — used when shown in a dialog. */
    val paywallDialog: androidx.compose.ui.unit.Dp = 24.dp,
) {
    companion object {
        val Default = PayCraftShape()
    }
}

// ------------------------------------------------------------------
// CompositionLocal
// ------------------------------------------------------------------

/** Active [PayCraftTheme] for the current composition. */
val LocalPayCraftTheme = staticCompositionLocalOf { PayCraftTheme.Default }

/**
 * Provides [theme] to all PayCraft composables in [content].
 *
 * Not required — PayCraft works without it using [PayCraftTheme.Default].
 */
@Composable
fun PayCraftThemeProvider(theme: PayCraftTheme = PayCraftTheme.Default, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalPayCraftTheme provides theme,
        content = content,
    )
}
