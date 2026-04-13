package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * PayCraft semantic color tokens.
 *
 * Use [PayCraftTheme.colors] to access the active color scheme rather than
 * instantiating these directly.
 */
data class PayCraftColors(
    /** Primary brand accent — used for selected plan borders, primary buttons, icons. */
    val accent: Color,

    /** Background of selected plan cards and premium status card. */
    val accentContainer: Color,

    /** Content on top of [accentContainer]. */
    val onAccentContainer: Color,

    /** Active badge background (green "ACTIVE" pill). */
    val activeBadge: Color,

    /** Content on top of [activeBadge]. */
    val onActiveBadge: Color,

    /** "Popular" badge background. */
    val popularBadge: Color,

    /** Content on top of [popularBadge]. */
    val onPopularBadge: Color,

    /** Error / warning background for error banners. */
    val errorContainer: Color,

    /** Content on top of [errorContainer]. */
    val onErrorContainer: Color,

    /** Surface for plan cards, sheets, and modals. */
    val surface: Color,

    /** Content on top of [surface]. */
    val onSurface: Color,

    /** Secondary content on top of [surface] (subtitles, hints). */
    val onSurfaceVariant: Color,

    /** Outline color for unselected plan cards. */
    val outline: Color,

    /** Border color for dividers and separators. */
    val divider: Color,
) {
    companion object {
        /**
         * Material3-adaptive default — reads tonal roles from the host app's MaterialTheme.
         *
         * Call [PayCraftTheme.default] to get a live instance that resolves against
         * the current Composition's MaterialTheme automatically.
         */
        @Suppress("MagicNumber")
        val Defaults = PayCraftColors(
            accent = Color(0xFF6750A4),
            accentContainer = Color(0xFFEADDFF),
            onAccentContainer = Color(0xFF21005D),
            activeBadge = Color(0xFF4CAF50),
            onActiveBadge = Color.White,
            popularBadge = Color(0xFFFF9800),
            onPopularBadge = Color.White,
            errorContainer = Color(0xFFFFDAD6),
            onErrorContainer = Color(0xFF410002),
            surface = Color.White,
            onSurface = Color(0xFF1C1B1F),
            onSurfaceVariant = Color(0xFF49454F),
            outline = Color(0xFFCAC4D0),
            divider = Color(0xFFE6E0E9),
        )
    }
}
