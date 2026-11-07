package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.config.SuiteConfig

/**
 * PayCraft theme configuration.
 *
 * ### Usage — default (Material3 adaptive)
 * PayCraft UI components read from [LocalPayCraftTheme] automatically. If you
 * don't wrap them in [PayCraftThemeProvider] they fall back to [PayCraftTheme.Default],
 * which reads tonal roles from the host app's [MaterialTheme].
 *
 * ### Usage — host inherit (SDK default; recommended)
 * ```kotlin
 * // Inside your host app's MaterialTheme:
 * PayCraftThemeProvider(config = PayCraft.suiteConfig) {
 *     PayCraftPaywall(onDismiss = { })
 * }
 * ```
 *
 * When `config` is `null` (or `config.themeOverride` is null), PayCraft inherits the
 * host's [MaterialTheme.colorScheme] and [MaterialTheme.typography] wholesale (AC-2).
 * When `config.themeOverride` is present, its [BrandedPalette] wins for the mapped
 * fields and everything else still inherits (AC-3).
 *
 * ### Usage — explicit token override
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
                    // Mapped, not defaulted: a dark host's primary is LIGHT, and the White default
                    // put white CTA text on a pale pill.
                    onAccent = mat.onPrimary,
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
 * Sole PayCraft theme entry point — resolves the effective MaterialTheme with a
 * **config-wins-else-host-inherit** precedence and provides the derived
 * [PayCraftTheme] tokens via [LocalPayCraftTheme].
 *
 * Precedence (per epic AC-2 + AC-3):
 * 1. If [config] carries a non-null [SuiteConfig.themeOverride] (dashboard set
 *    `paywall.theme_jsonb` / `paywall.primary_color`), its [BrandedPalette]
 *    layers on top of the host [MaterialTheme.colorScheme] — the branded
 *    fields win, unset fields inherit.
 * 2. Otherwise the resolved scheme IS the host [MaterialTheme.colorScheme]
 *    verbatim; PayCraft blends into the consumer app's Material3 palette.
 *
 * Typography always inherits the host [MaterialTheme.typography] — cloud brand
 * fonts are out of scope for the SDK's Compose layer.
 *
 * [LocalPayCraftTheme] is derived from the resolved MaterialTheme via the
 * [PayCraftTheme.materialAdaptive] semantics — so downstream token consumers
 * (`PayCraftTheme.colors.accent`, etc.) automatically pick up the config-wins
 * palette without any per-composable rewiring. When [theme] is anything other
 * than [PayCraftTheme.Default], the caller's explicit token axes win over the
 * adaptive derivation.
 */
@Composable
fun PayCraftThemeProvider(
    theme: PayCraftTheme = PayCraftTheme.Default,
    config: SuiteConfig? = null,
    content: @Composable () -> Unit,
) {
    val hostScheme = MaterialTheme.colorScheme
    val hostTypography = MaterialTheme.typography
    val branded = config?.themeOverride?.toColorScheme(hostScheme)
    val resolvedScheme = branded ?: hostScheme
    MaterialTheme(
        colorScheme = resolvedScheme,
        typography = hostTypography,
    ) {
        val payCraftTheme = if (theme == PayCraftTheme.Default) {
            PayCraftTheme.materialAdaptive()
        } else {
            theme
        }
        CompositionLocalProvider(
            LocalPayCraftTheme provides payCraftTheme,
            content = content,
        )
    }
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
