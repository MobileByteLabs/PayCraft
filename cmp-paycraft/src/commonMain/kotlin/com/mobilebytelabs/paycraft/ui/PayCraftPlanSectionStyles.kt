/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.PhoneIphone
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Shop
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_active_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_devices_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_card_chip_cancelled
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_card_chip_test
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_card_manage_subtitle
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_card_manage_subtitle_store
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_card_restore_subtitle
import com.mobilebytelabs.paycraft.model.EntitlementTier
import org.jetbrains.compose.resources.stringResource

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
            style = theme.rowTextStyle,
            color = theme.contentColor,
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing)) {
            // `_`, deliberately: Minimal is "the quietest option" for a list where billing is one
            // entry among thirty. Giving it the glyph + accent would make it the loudest row on the
            // screen, which is the opposite of what the style is for.
            PrimaryAction(state, copy, onUpgrade) { action ->
                TextButton(onClick = action.onClick, modifier = Modifier.testTag(action.tag)) { Text(action.label) }
            }
            state.onRestoreClick?.let { restore ->
                TextButton(
                    onClick = restore,
                    modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW),
                ) { Text(copy.restoreLabel, color = theme.supportingColor) }
            }
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
    // The Card body WITHOUT the card: a host's settings list already draws its own group, so Rows
    // contributes the same status header + action rows and lets the host's container frame them.
    PlanCardBody(state, copy, theme, onUpgrade)
}

// ── Card ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun CardSettings(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    // Stitch sdk-plan-card 02–05: one outlined surface holding the status header, a divider and
    // the action rows. Surface + outline come from the host's MaterialTheme, never a fixed colour.
    OutlinedCard(
        modifier = Modifier.fillMaxWidth().padding(theme.horizontalPadding),
        shape = theme.shape,
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        PlanCardBody(state, copy, theme, onUpgrade)
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
        // FLOW, not Row: at large font scales "Premium · CANCELLED · TEST" does not fit one line, and a
        // Row squeezed the last chip until it wrapped mid-word ("TE/ST", device 2026-11-02).
        FlowRow(
            itemVerticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                state.statusLabel,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = theme.contentColor,
                modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
            )
            StatusChip(state)
            TestChip(state)
        }
        state.planLine?.let { line ->
            Spacer(Modifier.height(4.dp))
            Text(
                line,
                style = theme.supportingTextStyle.copy(fontWeight = FontWeight.SemiBold),
                color = theme.accentColor,
                modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_PLAN_LINE),
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(
            state.supportingText,
            style = theme.supportingTextStyle,
            color = theme.supportingColor,
        )
        Spacer(Modifier.height(20.dp))
        // Hero's emphasis is the filled Button itself, so it needs neither the glyph nor the accent
        // tint — applying both would double up on a surface that already assumes it owns the viewport.
        PrimaryAction(state, copy, onUpgrade) { action ->
            Button(
                onClick = action.onClick,
                modifier = Modifier.fillMaxWidth().heightIn(min = theme.rowMinHeight).testTag(action.tag),
            ) { Text(action.label) }
        }
        state.onRestoreClick?.let { restore ->
            TextButton(
                onClick = restore,
                modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW),
            ) { Text(copy.restoreLabel, color = theme.supportingColor) }
        }
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
        TierBadge(state.tier, 32.dp, theme)
        Text(
            state.statusLabel,
            style = theme.rowTextStyle,
            fontWeight = FontWeight.SemiBold,
            color = theme.contentColor,
        )
        Text("·", color = theme.supportingColor)
        Text(
            state.supportingText,
            style = theme.supportingTextStyle,
            color = theme.supportingColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (action != null) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = theme.supportingColor,
            )
        }
    }
}

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────

/** What [PrimaryAction] resolved: label, tag, glyph, emphasis, subtitle and the tap. */
private class PlanAction(
    val label: String,
    val tag: String,
    val icon: ImageVector,
    val emphasized: Boolean,
    val subtitle: String?,
    val onClick: () -> Unit,
)

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
    render: @Composable (PlanAction) -> Unit,
) {
    // The icon + emphasis travel WITH the branch that chose the action. A caller re-deriving
    // "is this upgrade or manage" to pick a glyph would be a second copy of this `when`, free to
    // disagree with it — which is how a manage row ends up wearing the upgrade's accent.
    when {
        state.tier == EntitlementTier.FREE ->
            render(
                PlanAction(
                    copy.upgradeLabel,
                    PayCraftTestTags.SUBSCRIPTION_UPGRADE_ROW,
                    Icons.Default.WorkspacePremium,
                    // The one commercial action in the section, and the only emphasized row.
                    emphasized = true,
                    subtitle = null,
                    onClick = onUpgrade,
                ),
            )
        state.canManage -> {
            // Provider-aware: "Cancel or change your plan in Google Play" tells the user where the
            // cancel button actually lives before they tap — the dead end billedThrough guards.
            val subtitle = state.provider?.let {
                stringResource(Res.string.paycraft_plan_card_manage_subtitle_store, storeDisplayName(it))
            } ?: stringResource(Res.string.paycraft_plan_card_manage_subtitle)
            render(
                PlanAction(
                    copy.manageLabel,
                    PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW,
                    Icons.Default.ManageAccounts,
                    // Administrative, not commercial: a subscriber is not being sold to.
                    emphasized = false,
                    subtitle = subtitle,
                    onClick = state.onManage,
                ),
            )
        }
        else -> Unit
    }
}

/**
 * Status header, then the action rows — shared by Rows (bare) and Card (inside an outlined card),
 * so the two cannot drift apart.
 */
@Composable
private fun PlanCardBody(
    state: PlanSectionState,
    copy: PlanSectionCopy,
    theme: PayCraftPlanSectionTheme,
    onUpgrade: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        StatusBlock(state, theme)
        PrimaryAction(state, copy, onUpgrade) { action ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            TappableRow(
                action.label,
                action.tag,
                theme,
                action.icon,
                action.emphasized,
                action.subtitle,
                action.onClick,
            )
        }
        // "Your devices" — one subscription on phone, tablet and web; subscribers only (null otherwise).
        state.onDevicesClick?.let { open ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            TappableRow(
                stringResource(Res.string.paycraft_devices_title),
                PayCraftTestTags.SUBSCRIPTION_DEVICES_ROW,
                theme,
                Icons.Outlined.Devices,
                emphasized = false,
                subtitle = state.devicesSubtitle,
                onClick = open,
            )
        }
        // Restore is FREE-tier only — restoreActionFor() has already nulled it for anyone entitled.
        state.onRestoreClick?.let { restore ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            TappableRow(
                copy.restoreLabel,
                PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW,
                theme,
                Icons.Default.Restore,
                emphasized = false,
                subtitle = stringResource(Res.string.paycraft_plan_card_restore_subtitle),
                onClick = restore,
            )
        }
    }
}

@Composable
private fun StatusBlock(state: PlanSectionState, theme: PayCraftPlanSectionTheme) {
    // Stitch sdk-plan-card 04: tile · title + status chip · plan line, then — for a subscriber —
    // the billing owner with its renewal pill on one row. The badge leads, as it does in every
    // style; `showTierBadge = false` still opts a text-only list out.
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = theme.horizontalPadding, vertical = theme.verticalPadding + 4.dp)
            .testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing + 4.dp),
        ) {
            TierBadge(state.tier, 48.dp, theme)
            Column(Modifier.weight(1f)) {
                FlowRow(
                    itemVerticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        state.statusLabel,
                        style = theme.statusTextStyle.copy(fontWeight = FontWeight.Bold),
                        color = theme.contentColor,
                    )
                    StatusChip(state)
                    TestChip(state)
                }
                // Price and interval: what the user pays, in the accent — the line a subscription
                // card is read for.
                state.planLine?.let { line ->
                    Spacer(Modifier.height(2.dp))
                    Text(
                        line,
                        style = theme.supportingTextStyle.copy(fontWeight = FontWeight.SemiBold),
                        color = theme.accentColor,
                        modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_PLAN_LINE),
                    )
                }
                // No billing owner (free, or an entitled status with no provider): the supporting
                // line has no pill to live in, so it stays under the plan line.
                if (state.provider == null) {
                    Spacer(Modifier.height(2.dp))
                    Text(state.supportingText, style = theme.supportingTextStyle, color = theme.supportingColor)
                }
            }
        }
        state.provider?.let { provider -> ProviderRow(state, provider, theme) }
    }
}

/** Store glyph + name, then the renewal / trial / expiry pill — Stitch 04's provider row. */
@Composable
private fun ProviderRow(state: PlanSectionState, provider: String, theme: PayCraftPlanSectionTheme) {
    Spacer(Modifier.height(theme.verticalPadding))
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Spacer(Modifier.height(theme.verticalPadding))
    // FLOW with SpaceBetween: the pill sits right when it fits and drops below when it does not — a Row
    // gave the store name `weight(1f)` and the pill ate it ("Google …", device 2026-11-02).
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        itemVerticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                storeIcon(provider),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = theme.supportingColor,
            )
            Text(
                storeDisplayName(provider),
                style = theme.supportingTextStyle,
                color = theme.supportingColor,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier
                    .testTag(PayCraftTestTags.SUBSCRIPTION_BILLED_THROUGH)
                    // Read as the full sentence: "Google Play" alone does not say it is the biller.
                    .semantics { state.billedThrough?.let { contentDescription = it } },
            )
        }
        val (pillBg, pillFg) = if (state.cancelled) {
            MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        }
        Text(
            state.supportingText,
            style = MaterialTheme.typography.labelMedium,
            color = pillFg,
            maxLines = 1,
            modifier = Modifier
                .background(pillBg, RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

/**
 * The status chip beside the tier name — none for a free user (nothing to report), "Active" for a
 * live subscription or trial, "Cancelled" in the error role once auto-renew is off.
 */
@Composable
private fun StatusChip(state: PlanSectionState) {
    if (state.tier == EntitlementTier.FREE) return
    val colors = MaterialTheme.colorScheme
    val (label, bg, fg) = when {
        state.cancelled -> Triple(
            stringResource(Res.string.paycraft_plan_card_chip_cancelled),
            colors.errorContainer,
            colors.onErrorContainer,
        )
        state.tier == EntitlementTier.TRIAL -> Triple(
            stringResource(Res.string.paycraft_banner_active_badge),
            colors.tertiaryContainer,
            colors.onTertiaryContainer,
        )
        else -> Triple(
            stringResource(Res.string.paycraft_banner_active_badge),
            colors.primaryContainer,
            colors.onPrimaryContainer,
        )
    }
    Text(
        label.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        color = fg,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier
            .background(bg, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** "TEST" beside the status chip for a store test purchase — never on a real one. */
@Composable
private fun TestChip(state: PlanSectionState) {
    if (!state.isTest) return
    val colors = MaterialTheme.colorScheme
    Text(
        stringResource(Res.string.paycraft_plan_card_chip_test).uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.8.sp,
        color = colors.onSurfaceVariant,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier
            .border(1.dp, colors.outlineVariant, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp)
            .testTag(PayCraftTestTags.SUBSCRIPTION_TEST_CHIP),
    )
}

/** The store's own glyph, so the provider row reads at a glance. Unknown/web providers get a card. */
private fun storeIcon(provider: String): ImageVector = when (provider) {
    "google_play" -> Icons.Default.Shop
    "app_store" -> Icons.Default.PhoneIphone
    else -> Icons.Default.CreditCard
}

@Composable
private fun TappableRow(
    label: String,
    tag: String,
    theme: PayCraftPlanSectionTheme,
    leadingIcon: ImageVector,
    emphasized: Boolean,
    subtitle: String?,
    onClick: () -> Unit,
) {
    // Icon tile + label (+ subtitle) + chevron, not a bare Text.
    //
    // A plain string with an invisible `clickable` gives a user NOTHING that says it is tappable:
    // it sits in a settings list beside host rows that all carry an icon tile and a trailing
    // affordance, and reads as a label rather than an action. The chevron is the part that earns
    // its place — it is the platform convention for "this opens something".
    //
    // `emphasized` marks the single commercial action (upgrade, for a free user) with the theme
    // accent — tinted row, accent tile and label. One accent per section: the restore and manage
    // rows stay quiet so the thing worth tapping is obvious without shouting.
    val tint = if (emphasized) theme.accentColor else theme.supportingColor
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (emphasized) Modifier.background(theme.accentColor.copy(alpha = 0.06f)) else Modifier)
            .clickable(onClick = onClick)
            // >=48dp (NFR-010): a row people tap in order to cancel must not be fiddly.
            .heightIn(min = theme.rowMinHeight)
            .padding(horizontal = theme.horizontalPadding, vertical = theme.verticalPadding)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(theme.rowSpacing + 4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .background(
                    if (emphasized) theme.accentColor.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(10.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                leadingIcon,
                // Null: the LABEL already names the action, so announcing the glyph too would make a
                // screen reader read the row twice.
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = tint,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                text = label,
                style = theme.rowTextStyle.copy(
                    fontWeight = if (emphasized) FontWeight.SemiBold else FontWeight.Medium,
                ),
                color = if (emphasized) theme.accentColor else theme.contentColor,
            )
            subtitle?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = theme.supportingColor,
                )
            }
        }
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = theme.supportingColor,
        )
    }
}

/**
 * Tier mark: a rounded tile in the theme's icon-tile role. Theme colours only — no brand assets,
 * so it inherits the host's palette.
 */
@Composable
private fun TierBadge(tier: EntitlementTier, size: Dp, theme: PayCraftPlanSectionTheme) {
    if (!theme.showTierBadge) return
    // A free user's tile is muted: the accent tile is what being subscribed looks like.
    val (bg, fg) = if (tier == EntitlementTier.FREE) {
        MaterialTheme.colorScheme.surfaceVariant to theme.supportingColor
    } else {
        theme.iconTileBackground to theme.iconTileTint
    }
    Surface(shape = RoundedCornerShape(size * 0.28f), color = bg) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Default.Star,
                contentDescription = null,
                modifier = Modifier.size(size * 0.5f),
                tint = fg,
            )
        }
    }
}
