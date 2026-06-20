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
    val spacing: PayCraftSpacing = PayCraftSpacing.Default,
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

        /** Active [PayCraftTheme.spacing] in the current composition. */
        val spacing: PayCraftSpacing
            @Composable
            @ReadOnlyComposable
            get() = LocalPayCraftTheme.current.spacing

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
 * PayCraft spacing scale — the 4th token axis alongside colors, typography, and shape.
 *
 * Values follow the M3 4-dp grid. All paywall composables should read from
 * [PayCraftTheme.spacing] (via [LocalPayCraftTheme]) instead of hardcoding dp literals,
 * so host apps can override the density without touching component code.
 *
 * @param hairline 1 dp — hairline dividers, focus rings.
 * @param xs 4 dp — intra-label gaps, icon margins.
 * @param sm 8 dp — compact row padding, between-badge gaps.
 * @param md 16 dp — standard content padding, card inner margin.
 * @param lg 24 dp — sheet horizontal padding, section leading indent.
 * @param xl 32 dp — generous vertical breathing room, paywall top margin.
 * @param sectionGap 20 dp — vertical distance between logical sheet sections.
 * @param cardGap 8 dp — vertical gap between adjacent plan cards.
 */
data class PayCraftSpacing(
    val hairline: androidx.compose.ui.unit.Dp = 1.dp,
    val xs: androidx.compose.ui.unit.Dp = 4.dp,
    val sm: androidx.compose.ui.unit.Dp = 8.dp,
    val md: androidx.compose.ui.unit.Dp = 16.dp,
    val lg: androidx.compose.ui.unit.Dp = 24.dp,
    val xl: androidx.compose.ui.unit.Dp = 32.dp,
    val sectionGap: androidx.compose.ui.unit.Dp = 20.dp,
    val cardGap: androidx.compose.ui.unit.Dp = 8.dp,
) {
    companion object {
        val Default = PayCraftSpacing()
    }
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

// ------------------------------------------------------------------
// Paywall design-token aliases (AC-8 contract)
// ------------------------------------------------------------------

/**
 * Unified token contract for the branded paywall flow.
 *
 * [PaywallDesignToken] is the canonical name used by the PayCraft dashboard Paywall
 * designer and every branded-flow composable; it is a direct alias of [PayCraftTheme]
 * and carries the four token axes — colors, typography, shape, and spacing — in a
 * single coherent contract. Use [LocalPaywallDesignToken] to read the active token
 * set from the composition.
 */
typealias PaywallDesignToken = PayCraftTheme

/**
 * [CompositionLocal] that holds the active [PaywallDesignToken] (= [PayCraftTheme]).
 *
 * This is an alias of [LocalPayCraftTheme]; both names refer to the same
 * [CompositionLocal] instance. Branded-flow composables can read from either name
 * interchangeably; writing to one is equivalent to writing to the other.
 *
 * @see PaywallDesignToken
 * @see LocalPayCraftTheme
 */
val LocalPaywallDesignToken get() = LocalPayCraftTheme
