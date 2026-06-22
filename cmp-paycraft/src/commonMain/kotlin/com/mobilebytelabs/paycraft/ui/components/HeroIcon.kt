package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Resolves a dashboard-provided paywall branding icon into a tintable [ImageVector].
 *
 * The PayCraft dashboard lets a tenant replace the default SDK hero icon with their own
 * app's branding mark by storing its **inline SVG path data** (the `d` attribute of a
 * single-path SVG, normalized to a 24×24 viewport — the same grid the bundled provider
 * marks use) in `PaywallDto.heroIconSvg`. We parse it with Compose's multiplatform
 * [PathParser] → an [ImageVector], so the branding icon renders on every KMP target with
 * NO platform SVG engine and NO extra dependency.
 *
 * The fill is solid white because every call site wraps the result in an `Icon(...)` whose
 * `tint` recolors the whole vector (typically to the brand `onPrimary`), so the path color
 * here is irrelevant.
 *
 * Returns `null` when no icon is configured OR the path string can't be parsed — callers
 * fall back to the SDK's default branding icon, so a malformed override never blanks the
 * hero.
 *
 * @param heroIconSvg `PaywallDto.heroIconSvg` — inline 24×24 SVG path data, or null/blank.
 */
@Composable
fun rememberHeroIconOverride(heroIconSvg: String?): ImageVector? =
    remember(heroIconSvg) { parseHeroIconPath(heroIconSvg) }

/**
 * Pure (non-composable) parse of [heroIconSvg] inline path data → [ImageVector], or null when
 * absent/blank/unparseable. Extracted from [rememberHeroIconOverride] so the parsing contract
 * is unit-testable without a Compose runtime.
 */
fun parseHeroIconPath(heroIconSvg: String?): ImageVector? {
    val raw = heroIconSvg?.trim()?.takeIf { it.isNotBlank() } ?: return null
    return runCatching {
        val nodes = PathParser().parsePathString(raw).toNodes()
        check(nodes.isNotEmpty()) { "empty path" }
        ImageVector.Builder(
            name = "paycraftHeroIcon",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).addPath(pathData = nodes, fill = SolidColor(Color.White)).build()
    }.getOrNull()
}
