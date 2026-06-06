package com.mobilebytelabs.paycraft.presentation

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Default PayCraft brand theme — used by all 3 [PaywallTemplate]s unless overridden
 * by the cloud's `theme_jsonb` value at runtime (per AC-8).
 */
object MobileByteSenseiTheme {
    val colorsLight: ColorScheme = lightColorScheme(
        primary = Color(0xFF6B4FE3),
        secondary = Color(0xFFFFB400),
        background = Color(0xFFFAFAFA),
        surface = Color.White,
        error = Color(0xFFE53935),
    )

    val colorsDark: ColorScheme = darkColorScheme(
        primary = Color(0xFF9D7FFF),
        secondary = Color(0xFFFFD159),
        background = Color(0xFF121212),
        surface = Color(0xFF1E1E1E),
        error = Color(0xFFFF5252),
    )

    val typography: Typography = Typography(
        headlineLarge = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.Bold),
        titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Normal),
        labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    )
}

/** Tenant-level theme override map (key → hex string). Read from cloud `theme_jsonb`. */
val LocalThemeOverride = staticCompositionLocalOf<Map<String, String>> { emptyMap() }

/**
 * Wraps content in a MaterialTheme keyed off [MobileByteSenseiTheme] with optional
 * per-tenant override (cloud-driven). Theme override keys: `primary`, `secondary`,
 * `background`, `surface`, `error`. Values are hex strings like `#7C3AED`.
 */
@Composable
fun PayCraftThemeProvider(
    themeOverride: Map<String, String> = emptyMap(),
    useDark: Boolean = false,
    content: @Composable () -> Unit,
) {
    val base = if (useDark) MobileByteSenseiTheme.colorsDark else MobileByteSenseiTheme.colorsLight
    val resolved = if (themeOverride.isEmpty()) base else applyThemeOverride(base, themeOverride)
    MaterialTheme(
        colorScheme = resolved,
        typography = MobileByteSenseiTheme.typography,
        content = content,
    )
}

private fun applyThemeOverride(base: ColorScheme, override: Map<String, String>): ColorScheme {
    val primary = override["primary"]?.let(::parseHexColor) ?: base.primary
    val secondary = override["secondary"]?.let(::parseHexColor) ?: base.secondary
    val background = override["background"]?.let(::parseHexColor) ?: base.background
    val surface = override["surface"]?.let(::parseHexColor) ?: base.surface
    val error = override["error"]?.let(::parseHexColor) ?: base.error
    return base.copy(
        primary = primary,
        secondary = secondary,
        background = background,
        surface = surface,
        error = error,
    )
}

/**
 * Multiplatform hex-color parser. Accepts `#RRGGBB`, `#AARRGGBB`, `RRGGBB`, `AARRGGBB`.
 * Falls back to null-equivalent (Color.Unspecified) on unparseable input — callers
 * default to the base scheme value.
 */
internal fun parseHexColor(hex: String): Color {
    val trimmed = hex.trim().removePrefix("#")
    val normalized = when (trimmed.length) {
        6 -> "FF$trimmed"
        8 -> trimmed
        else -> return Color.Unspecified
    }
    val parsed = normalized.toLongOrNull(16) ?: return Color.Unspecified
    val alpha = ((parsed shr 24) and 0xFF).toInt()
    val red = ((parsed shr 16) and 0xFF).toInt()
    val green = ((parsed shr 8) and 0xFF).toInt()
    val blue = (parsed and 0xFF).toInt()
    return Color(red = red, green = green, blue = blue, alpha = alpha)
}
