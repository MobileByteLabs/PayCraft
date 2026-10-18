/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
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
         * Tokens derived from a design system, in ITS vocabulary.
         *
         * ## Why these parameters and not the 16 fields
         *
         * The data class carries 16 flat fields, which made adoption a hand-mapping exercise — a
         * consumer read each one, decided which of its own tokens matched, and wrote a `copy()`.
         * Every app then encoded the same mapping slightly differently.
         *
         * These parameters are the design-system's OWN groups instead: a colour scheme, a
         * typography set, a shape, a spacing scale, and the one genuinely app-specific choice (the
         * icon-tile role). They map 1:1 onto what a KMP design system already exposes — in the
         * kmp-project-template vocabulary, `KptTheme.colorScheme` / `.typography` / `.shapes` /
         * `.spacing` — so adoption is passing what you already have, not translating it.
         *
         * Everything defaults to the ambient `MaterialTheme`, so an app that themes itself and
         * passes NOTHING already gets its own palette, shape and type.
         */
        @Composable
        @ReadOnlyComposable
        fun defaults(
            colors: ColorScheme = MaterialTheme.colorScheme,
            typography: Typography = MaterialTheme.typography,
            /** Card / badge corners. A design system passes its own — e.g. `KptTheme.shapes.medium`. */
            shape: Shape = RoundedCornerShape(12.dp),
            /** The spacing scale. Pass your own — e.g. `PayCraftSpacing(KptTheme.spacing)`. */
            spacing: PayCraftSpacing = PayCraftSpacing.Default,
            /**
             * Which colour role paints the tier badge's tile.
             *
             * The ONE thing apps actually differ on, and the reason this is a named role rather
             * than two raw colours: a consumer saying `tileRole = Tertiary` keeps tracking its own
             * theme (including dark mode and dynamic colour), where
             * `iconTileBackground = someColor` freezes a value that stops following it.
             */
            tileRole: PayCraftTileRole = PayCraftTileRole.Secondary,
            /** `false` suits a text-only settings list. Affects Card / Hero / Compact. */
            showTierBadge: Boolean = true,
        ): PayCraftPlanSectionTheme = PayCraftPlanSectionTheme(
            containerColor = Color.Transparent,
            contentColor = colors.onSurface,
            supportingColor = colors.onSurfaceVariant,
            iconTileBackground = tileRole.container(colors),
            iconTileTint = tileRole.onContainer(colors),
            accentColor = colors.primary,
            onAccentColor = colors.onPrimary,
            shape = shape,
            statusTextStyle = typography.titleMedium,
            supportingTextStyle = typography.bodyMedium,
            rowTextStyle = typography.bodyLarge,
            horizontalPadding = spacing.horizontalPadding,
            verticalPadding = spacing.verticalPadding,
            rowSpacing = spacing.rowSpacing,
            rowMinHeight = spacing.rowMinHeight,
            showTierBadge = showTierBadge,
        )
    }
}

/**
 * The plan-section theme for everything below this point.
 *
 * ## Why a composition local and not a parameter at each call site
 *
 * The parameter alone made every call site restate the app's tokens:
 *
 * ```kotlin
 * PayCraftPlanSection(
 *     theme = PayCraftPlanSectionTheme.defaults().copy(
 *         iconTileBackground = MaterialTheme.colorScheme.tertiaryContainer,
 *         iconTileTint = MaterialTheme.colorScheme.onTertiaryContainer,
 *     ),
 *     header = { … },
 * )
 * ```
 *
 * That is the app's design system, repeated — and it drifts the moment a second surface appears
 * and gets a different `copy()`. An app has ONE answer to "what do PayCraft's rows look like here",
 * so it should say it ONCE:
 *
 * ```kotlin
 * ProvidePayCraftPlanSectionTheme(
 *     PayCraftPlanSectionTheme.defaults().copy(
 *         iconTileBackground = MaterialTheme.colorScheme.tertiaryContainer,
 *         iconTileTint = MaterialTheme.colorScheme.onTertiaryContainer,
 *     ),
 * ) { App() }
 *
 * // …anywhere inside:
 * PayCraftPlanSection(header = { SectionHeader("Subscription") })
 * ```
 *
 * Same seam as [com.mobilebytelabs.paycraft.ui.components.LocalPayCraftOAuthHandler]: provided
 * once around the app, read by every surface that needs it.
 *
 * `null` means "nobody provided one", which resolves to [PayCraftPlanSectionTheme.defaults] — the
 * ambient `MaterialTheme`. So an app that themes itself and provides NOTHING still gets its own
 * palette, shape and type. The local is for the tokens Material cannot express.
 *
 * The `theme` parameter survives as a per-call override, for the one screen that legitimately
 * differs from the app-wide answer.
 */
val LocalPayCraftPlanSectionTheme = staticCompositionLocalOf<PayCraftPlanSectionTheme?> { null }

/** Provide [theme] to every PayCraft plan surface in [content]. See [LocalPayCraftPlanSectionTheme]. */
@Composable
fun ProvidePayCraftPlanSectionTheme(theme: PayCraftPlanSectionTheme, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalPayCraftPlanSectionTheme provides theme, content = content)

/**
 * The theme in effect: the provided one, else the [MaterialTheme]-derived defaults.
 *
 * This is what the `theme` parameter defaults to, so a call site that passes nothing picks up the
 * app-wide answer rather than the SDK's.
 */
@Composable
@ReadOnlyComposable
fun rememberPayCraftPlanSectionTheme(): PayCraftPlanSectionTheme =
    LocalPayCraftPlanSectionTheme.current ?: PayCraftPlanSectionTheme.defaults()

/**
 * Which colour role paints the tier-badge tile.
 *
 * A ROLE, not a colour, so the choice keeps tracking the host's theme — dark mode and dynamic
 * colour included. Naming a raw `Color` freezes one value and silently stops following the app.
 */
enum class PayCraftTileRole {
    Primary,
    Secondary,
    Tertiary,
    ;

    internal fun container(c: ColorScheme): Color = when (this) {
        Primary -> c.primaryContainer
        Secondary -> c.secondaryContainer
        Tertiary -> c.tertiaryContainer
    }

    internal fun onContainer(c: ColorScheme): Color = when (this) {
        Primary -> c.onPrimaryContainer
        Secondary -> c.onSecondaryContainer
        Tertiary -> c.onTertiaryContainer
    }
}

/**
 * The spacing a plan surface needs, in a design system's own scale.
 *
 * Four values rather than a full xs…xxl ramp: those are the only four the rows consume, and a
 * theme that asked for six would make a consumer supply two it cannot see the effect of. Map from
 * whatever scale you have — in the kmp-project-template vocabulary:
 *
 * ```kotlin
 * PayCraftSpacing(
 *     horizontalPadding = KptTheme.spacing.md,
 *     verticalPadding   = KptTheme.spacing.sm,
 *     rowSpacing        = KptTheme.spacing.sm,
 * )
 * ```
 */
@Immutable
data class PayCraftSpacing(
    val horizontalPadding: Dp = 16.dp,
    val verticalPadding: Dp = 12.dp,
    val rowSpacing: Dp = 8.dp,
    /**
     * Minimum tappable height. Defaults to 48dp (NFR-010) and should not go below it: this is the
     * row a user taps in order to CANCEL, and a fiddly target there is the worst place to save
     * space. It is a parameter so a design system with a larger touch target can raise it.
     */
    val rowMinHeight: Dp = 48.dp,
) {
    companion object {
        val Default = PayCraftSpacing()
    }
}
