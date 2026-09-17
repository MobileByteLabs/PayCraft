package com.mobilebytelabs.paycraft.presentation.tree

import androidx.compose.ui.graphics.Color
import com.mobilebytelabs.paycraft.ui.theme.parseHexColor

/**
 * Convert a component-tree colour string to a [Color].
 *
 * ## Why this is not just `parseHexColor`
 * The two sources disagree about where alpha goes, and the disagreement is INVISIBLE at the type
 * level — both are 8-hex-digit strings:
 *
 *  - The tree is authored by a web dashboard and uses CSS order, **RRGGBBAA** (`#010101ff` = opaque
 *    near-black; `#FFFFFFcc` = translucent white).
 *  - [parseHexColor] is the SDK's existing reader for `theme_jsonb`/`primary_color` and uses
 *    Android order, **AARRGGBB**.
 *
 * Passing a tree colour straight into [parseHexColor] therefore reads `#010101ff` as alpha `0x01` —
 * a 0.4%-opacity title, i.e. text that renders as nothing on any background. It compiles, it throws
 * nothing, and it looks like a missing-content bug rather than a colour bug.
 *
 * So tree colours are converted to the SDK's order here, once, instead of at each call site.
 * 6-digit values are unambiguous and passed through untouched.
 */
internal fun treeColorOrNull(hex: String?): Color? {
    val raw = hex?.trim()?.removePrefix("#")?.takeIf { it.isNotEmpty() } ?: return null
    val androidOrder = when (raw.length) {
        8 -> raw.substring(6, 8) + raw.substring(0, 6) // RRGGBBAA → AARRGGBB
        6 -> raw
        else -> return null
    }
    return parseHexColor(androidOrder).takeIf { it != Color.Unspecified }
}

/**
 * Design TOKENS a tree may name instead of a literal hex (D11: "schema_version 2 introduces tokens").
 *
 * ## Why a built-in seed must not hardcode a brand colour
 * The seeds shipped with `#6C4FC7` — PayCraft's purple — for the savings chip and the selection
 * ring. That is correct in PayCraft's own sample app and wrong in every consumer: cappy is cream and
 * brown, and rendered a purple chip inside its own paywall. A tenant who never authored a tree has
 * no way to fix that, because the colour lives in an asset inside the SDK.
 *
 * A token resolves against the tenant's theme (which `primary_color` already feeds), so the same
 * seed is on-brand everywhere. A literal hex still wins where an author wrote one — a deliberately
 * dark template declares its own palette and must keep it.
 */
internal fun treeTokenColorOrNull(raw: String?, colors: com.mobilebytelabs.paycraft.ui.theme.PayCraftColors): Color? =
    when (raw?.trim()?.lowercase()) {
        "accent" -> colors.accent
        // The 10%-alpha wash behind a selected plan. Derived from the accent rather than authored,
        // so it tracks a tenant's brand instead of drifting from it.
        "accent_soft" -> colors.accent.copy(alpha = 0.10f)
        "on_accent" -> colors.onAccent
        "surface" -> colors.surface
        "on_surface" -> colors.onSurface
        "on_surface_variant" -> colors.onSurfaceVariant
        else -> null
    }
