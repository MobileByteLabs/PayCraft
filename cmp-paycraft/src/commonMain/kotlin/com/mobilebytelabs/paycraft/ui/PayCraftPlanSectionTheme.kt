/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How [PayCraftPlanSection] should LOOK inside this app.
 *
 * ## Why a theme instead of exposing the state
 *
 * An earlier draft made the computed state public so a host could draw the rows itself. That
 * inverted the point of putting the section in the SDK: handing a consumer `statusLabel`,
 * `canManage` and `onManage` and asking them to assemble it is the same work they were already
 * doing, minus a tier `when`.
 *
 * The real problem was never that hosts want different DATA — it is that an SDK-drawn row looks
 * foreign in someone else's list. So the SDK keeps the state and the decisions, and the host passes
 * its design tokens. cappy's settings rows vary exactly four things — icon tile background, tile
 * tint, label colour, and a spacing scale — which is what this type carries.
 *
 * ## Defaults already adopt the host
 *
 * Every default reads from [MaterialTheme], so a host that wraps the SDK in its own theme — which
 * every Compose app does — gets its own palette, shapes and type with no argument at all. Pass a
 * value only where your design system diverges from what Material exposes, such as a spacing scale
 * the SDK cannot see.
 *
 * ```kotlin
 * PayCraftPlanSection(
 *     style = PayCraftPlanSectionStyle.Rows,
 *     theme = PayCraftPlanSectionTheme.defaults().copy(
 *         iconTileBackground = MaterialTheme.colorScheme.tertiaryContainer,
 *         rowSpacing = MaterialTheme.spacing.md,
 *     ),
 * )
 * ```
 */
@Immutable
data class PayCraftPlanSectionTheme(
    /** Behind the section as a whole. `Transparent` lets a host's own group container show. */
    val containerColor: Color,
    /** Primary text. */
    val contentColor: Color,
    /** The supporting line under the status — renewal date, days left. */
    val supportingColor: Color,
    /** Behind the tier badge. */
    val iconTileBackground: Color,
    /** The tier glyph itself. */
    val iconTileTint: Color,
    /** Fill for the one prominent action, used by [PayCraftPlanSectionStyle.Hero]. */
    val accentColor: Color,
    /** On [accentColor]. */
    val onAccentColor: Color,
    /** Card / badge corners. */
    val shape: Shape,
    val statusTextStyle: TextStyle,
    val supportingTextStyle: TextStyle,
    val rowTextStyle: TextStyle,
    /** Horizontal inset for rows. Match the host's list inset or the section will look misaligned. */
    val horizontalPadding: Dp,
    /** Vertical inset within a row. */
    val verticalPadding: Dp,
    /** Gap between stacked elements. */
    val rowSpacing: Dp,
    /**
     * Minimum tappable height.
     *
     * Defaults to 48dp (NFR-010) and should not go below it: this is the row a user taps in order
     * to cancel, and a fiddly target there is the worst place to save space.
     */
    val rowMinHeight: Dp,
    /** Whether the tier badge is drawn at all. `false` suits a text-only settings list. */
    val showTierBadge: Boolean,
) {
    companion object {
        /**
         * Tokens read from the ambient [MaterialTheme].
         *
         * `@ReadOnlyComposable` because it only reads composition locals — it allocates no slots,
         * so calling it per style costs nothing.
         */
        @Composable
        @ReadOnlyComposable
        fun defaults(): PayCraftPlanSectionTheme = PayCraftPlanSectionTheme(
            containerColor = Color.Transparent,
            contentColor = MaterialTheme.colorScheme.onSurface,
            supportingColor = MaterialTheme.colorScheme.onSurfaceVariant,
            iconTileBackground = MaterialTheme.colorScheme.secondaryContainer,
            iconTileTint = MaterialTheme.colorScheme.onSecondaryContainer,
            accentColor = MaterialTheme.colorScheme.primary,
            onAccentColor = MaterialTheme.colorScheme.onPrimary,
            shape = RoundedCornerShape(12.dp),
            statusTextStyle = MaterialTheme.typography.titleMedium,
            supportingTextStyle = MaterialTheme.typography.bodyMedium,
            rowTextStyle = MaterialTheme.typography.bodyLarge,
            horizontalPadding = 16.dp,
            verticalPadding = 12.dp,
            rowSpacing = 8.dp,
            rowMinHeight = 48.dp,
            showTierBadge = true,
        )
    }
}
