/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.EntitlementTier

/**
 * How [PayCraftPlanSection] draws itself.
 *
 * Five presets, chosen so they differ STRUCTURALLY rather than cosmetically — density and
 * prominence, not colour. Five skins of one layout would be five things to maintain and one real
 * choice; these answer different questions about where the section sits.
 *
 * A host whose design system is specific enough that none of these quite fit adjusts
 * [PayCraftPlanSectionTheme] rather than drawing its own rows. The computed state is internal
 * deliberately: handing it out and asking a consumer to assemble a section is the work this
 * component exists to remove.
 */
enum class PayCraftPlanSectionStyle {
    /**
     * One status line, actions as text buttons. The quietest option.
     *
     * For a long settings list where billing is one entry among thirty and should not shout.
     */
    Minimal,

    /**
     * Status line, then full-width tappable rows with dividers. The conventional settings section,
     * and the default.
     */
    Rows,

    /**
     * Status in an elevated card with a tier accent, actions beneath.
     *
     * For an app where the subscription is a feature rather than an administrative detail.
     */
    Card,

    /**
     * Large tier badge, status, renewal detail and a filled primary action.
     *
     * For a DEDICATED subscription screen, not a row in a list — it assumes it owns the viewport.
     */
    Hero,

    /**
     * A single inline row: `Premium · Renews 14 Nov ›`.
     *
     * For a profile header or an account summary, where the whole section must collapse to one
     * line. Tapping it opens manage (or upgrade when free); restore is NOT shown — one line has
     * room for one action, and hiding restore behind a chevron is worse than leaving it to the
     * screen this links to.
     */
    Compact,
}

// ── Minimal ──────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun MinimalSettings(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = theme.horizontalPadding, vertical = theme.rowSpacing)) {
        // The tier NAME leads, then the supporting line, on one line.
        //
        // This used to render `supportingText` alone and ignore `state.statusLabel` — which a
        // screenshot test caught the first time these styles were ever rendered. For a subscriber
        // the supporting line is a date ("Renews 14 Nov 2026"), so the row read as "renews WHAT?":
        // self-describing only if the host passed a `header`, which is optional. Minimal is the
        // style for a long settings list, which is exactly where an unlabelled date is ambiguous.
        //
        // Still ONE line — the point of this preset — and the separator is dropped when there is no
        // supporting text to join, rather than leaving a dangling "Premium ·".
        Text(
            listOf(state.statusLabel, state.supportingText).filter { it.isNotBlank() }.joinToString(" · "),
            style = theme.supportingTextStyle,
            color = theme.supportingColor,
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing)) {
            // `_`, deliberately: Minimal is "the quietest option" for a list where billing is one
            // entry among thirty. Giving it the glyph + accent would make it the loudest row on the
            // screen, which is the opposite of what the style is for.
            PrimaryAction(state, copy, onUpgrade) { label, tag, _, _, click ->
                TextButton(onClick = click, modifier = Modifier.testTag(tag)) { Text(label) }
            }
            TextButton(
                onClick = state.onRestoreClick,
                modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW),
            ) { Text(copy.restoreLabel) }
        }
    }
}

// ── Rows (default) ───────────────────────────────────────────────────────────────────────────────

@Composable
internal fun RowsSettings(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    StatusBlock(state, theme)
    PrimaryAction(state, copy, onUpgrade) { label, tag, icon, emphasized, click ->
        TappableRow(label, tag, theme, icon, emphasized, click)
    }
    HorizontalDivider()
    TappableRow(
        copy.restoreLabel,
        PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW,
        theme,
        Icons.Default.Restore,
        emphasized = false,
        onClick = state.onRestoreClick,
    )
}

// ── Card ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun CardSettings(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TierBadge(state.tier, 40.dp, theme)
            Column(Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW)) {
                Text(state.statusLabel, style = theme.statusTextStyle)
                Text(
                    state.supportingText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider()
        PrimaryAction(state, copy, onUpgrade) { label, tag, icon, emphasized, click ->
            TappableRow(label, tag, theme, icon, emphasized, click)
        }
        HorizontalDivider()
        TappableRow(
            copy.restoreLabel,
            PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW,
            theme,
            Icons.Default.Restore,
            emphasized = false,
            onClick = state.onRestoreClick,
        )
    }
}

// ── Hero ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun HeroSettings(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TierBadge(state.tier, 64.dp, theme)
        Spacer(Modifier.height(12.dp))
        Text(
            state.statusLabel,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            state.supportingText,
            style = theme.supportingTextStyle,
            color = theme.supportingColor,
        )
        Spacer(Modifier.height(20.dp))
        // Hero's emphasis is the filled Button itself, so it needs neither the glyph nor the accent
        // tint — applying both would double up on a surface that already assumes it owns the viewport.
        PrimaryAction(state, copy, onUpgrade) { label, tag, _, _, click ->
            Button(
                onClick = click,
                modifier = Modifier.fillMaxWidth().heightIn(min = theme.rowMinHeight).testTag(tag),
            ) { Text(label) }
        }
        TextButton(
            onClick = state.onRestoreClick,
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW),
        ) { Text(copy.restoreLabel) }
    }
}

// ── Compact ──────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun CompactSettings(state: PlanSectionState, theme: PayCraftPlanSectionTheme, onUpgrade: () -> Unit) {
    // Free -> upgrade, otherwise manage. When neither is available (entitled, but nowhere to
    // manage) the row is INERT rather than absent: the status is still worth showing, and a
    // chevron-less row reads as information instead of a broken control.
    val action: (() -> Unit)? = when {
        state.tier == EntitlementTier.FREE -> onUpgrade
        state.canManage -> state.onManage
        else -> null
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (action != null) Modifier.clickable(onClick = action) else Modifier)
            .heightIn(min = theme.rowMinHeight)
            .padding(horizontal = theme.horizontalPadding, vertical = theme.verticalPadding)
            .testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing),
    ) {
        TierBadge(state.tier, 28.dp, theme)
        Text(state.statusLabel, style = MaterialTheme.typography.bodyLarge)
        Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            state.supportingText,
            style = theme.supportingTextStyle,
            color = theme.supportingColor,
            modifier = Modifier.weight(1f),
        )
        if (action != null) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = theme.iconTileTint,
            )
        }
    }
}

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────

/**
 * The one action that differs by entitlement: upgrade when free, manage when entitled, and NOTHING
 * when entitled with nowhere to manage.
 *
 * Centralised because getting it wrong is the classic settings bug in both directions — offering
 * "Upgrade" to a paying subscriber, or rendering "Manage subscription" as a dead tap on a platform
 * with no store page. Every style routes through here so no style can disagree.
 */
@Composable
private fun PrimaryAction(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    onUpgrade: () -> Unit,
    render: @Composable (label: String, tag: String, icon: ImageVector, emphasized: Boolean, onClick: () -> Unit) -> Unit,
) {
    // The icon + emphasis travel WITH the branch that chose the action. A caller re-deriving
    // "is this upgrade or manage" to pick a glyph would be a second copy of this `when`, free to
    // disagree with it — which is how a manage row ends up wearing the upgrade's accent.
    when {
        state.tier == EntitlementTier.FREE ->
            render(
                copy.upgradeLabel,
                PayCraftTestTags.SUBSCRIPTION_UPGRADE_ROW,
                Icons.Default.WorkspacePremium,
                // The one commercial action in the section, and the only emphasized row.
                true,
                onUpgrade,
            )
        state.canManage ->
            render(
                copy.manageLabel,
                PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW,
                Icons.Default.ManageAccounts,
                // Administrative, not commercial: a subscriber is not being sold to.
                false,
                state.onManage,
            )
        else -> Unit
    }
}

@Composable
private fun StatusBlock(state: PlanSectionState, theme: PayCraftPlanSectionTheme) {
    // The badge leads, as it does in Card/Hero/Compact. Rows is the DEFAULT style and was the only
    // one that never drew it — so `showTierBadge`, which defaults to `true`, was silently inert
    // exactly where most consumers meet this component. The result read as placeholder text beside
    // a host's own icon-led settings rows (observed in cappy on device, 2026-10-19).
    //
    // `TierBadge` still honours `showTierBadge = false`, so a text-only list opts out as before.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = theme.horizontalPadding, vertical = theme.verticalPadding)
            .testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing),
    ) {
        TierBadge(state.tier, 40.dp, theme)
        Column {
            // Tier, then the commercial line, then the operational one. Status first and price
            // beside it is the ordering a subscription card is expected to use — a user checking
            // this screen is answering "what am I on and what does it cost", and burying the price
            // behind the upgrade tap makes them leave the screen to find out.
            Text(state.statusLabel, style = theme.statusTextStyle)
            state.planLine?.let { line ->
                Spacer(Modifier.height(2.dp))
                Text(
                    line,
                    style = theme.supportingTextStyle,
                    color = theme.contentColor,
                    modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_PLAN_LINE),
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                state.supportingText,
                style = theme.supportingTextStyle,
                color = theme.supportingColor,
            )
            // Last, and quiet: it matters only when someone goes looking for where to cancel, and
            // it must not compete with the price. Absent entirely for a free user.
            state.billedThrough?.let { store ->
                Spacer(Modifier.height(2.dp))
                Text(
                    store,
                    style = theme.supportingTextStyle,
                    color = theme.supportingColor,
                    modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_BILLED_THROUGH),
                )
            }
        }
    }
}

@Composable
private fun TappableRow(
    label: String,
    tag: String,
    theme: PayCraftPlanSectionTheme,
    leadingIcon: ImageVector,
    emphasized: Boolean,
    onClick: () -> Unit,
) {
    // Icon + label + chevron, not a bare Text.
    //
    // A plain string with an invisible `clickable` gives a user NOTHING that says it is tappable:
    // it sits in a settings list beside host rows that all carry an icon tile and a trailing
    // affordance, and reads as a label rather than an action. The chevron is the part that earns
    // its place — it is the platform convention for "this opens something".
    //
    // `emphasized` marks the single commercial action (upgrade, for a free user) by tinting it with
    // the theme accent. One accent per section: the restore and manage rows stay quiet so the thing
    // worth tapping is obvious without shouting.
    val tint = if (emphasized) theme.accentColor else theme.supportingColor
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            // >=48dp (NFR-010): a row people tap in order to cancel must not be fiddly.
            .heightIn(min = theme.rowMinHeight)
            .padding(horizontal = theme.horizontalPadding, vertical = theme.verticalPadding)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing),
    ) {
        Icon(
            leadingIcon,
            // Null: the LABEL already names the action, so announcing the glyph too would make a
            // screen reader read the row twice.
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = tint,
        )
        Text(
            text = label,
            style = theme.rowTextStyle,
            color = if (emphasized) theme.accentColor else theme.contentColor,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = theme.supportingColor,
        )
    }
}

/** Tier mark. Theme colours only — no brand assets, so it inherits the host's palette. */
@Composable
private fun TierBadge(tier: EntitlementTier, size: androidx.compose.ui.unit.Dp, theme: PayCraftPlanSectionTheme) {
    if (!theme.showTierBadge) return
    Surface(shape = RoundedCornerShape(50), color = theme.iconTileBackground) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Default.Stars,
                contentDescription = null,
                modifier = Modifier.size(size * 0.55f),
                tint = theme.iconTileTint,
            )
        }
    }
}
