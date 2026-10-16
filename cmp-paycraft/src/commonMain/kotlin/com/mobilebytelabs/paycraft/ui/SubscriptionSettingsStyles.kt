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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.EntitlementTier

/**
 * How [PayCraftSubscriptionSettings] draws itself.
 *
 * Five presets, chosen so they differ STRUCTURALLY rather than cosmetically — density and
 * prominence, not colour. Five skins of one layout would be five things to maintain and one real
 * choice; these answer different questions about where the section sits.
 *
 * A host whose design system is specific enough that none of these fit should use
 * [rememberSubscriptionSettingsState] and draw its own. That is not a fallback — for an app with
 * its own row components it is the better path, and it still never writes the tier mapping.
 */
enum class SubscriptionSettingsStyle {
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
internal fun MinimalSettings(state: SubscriptionSettingsState, copy: SubscriptionSettingsCopy, onUpgrade: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(
            state.supportingText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryAction(state, copy, onUpgrade) { label, tag, click ->
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
internal fun RowsSettings(state: SubscriptionSettingsState, copy: SubscriptionSettingsCopy, onUpgrade: () -> Unit) {
    StatusBlock(state)
    PrimaryAction(state, copy, onUpgrade) { label, tag, click -> TappableRow(label, tag, click) }
    HorizontalDivider()
    TappableRow(copy.restoreLabel, PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW, state.onRestoreClick)
}

// ── Card ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun CardSettings(state: SubscriptionSettingsState, copy: SubscriptionSettingsCopy, onUpgrade: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TierBadge(state.tier, size = 40.dp)
            Column(Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW)) {
                Text(state.statusLabel, style = MaterialTheme.typography.titleMedium)
                Text(
                    state.supportingText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider()
        PrimaryAction(state, copy, onUpgrade) { label, tag, click -> TappableRow(label, tag, click) }
        HorizontalDivider()
        TappableRow(copy.restoreLabel, PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW, state.onRestoreClick)
    }
}

// ── Hero ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
internal fun HeroSettings(state: SubscriptionSettingsState, copy: SubscriptionSettingsCopy, onUpgrade: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TierBadge(state.tier, size = 64.dp)
        Spacer(Modifier.height(12.dp))
        Text(
            state.statusLabel,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            state.supportingText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        PrimaryAction(state, copy, onUpgrade) { label, tag, click ->
            Button(
                onClick = click,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag),
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
internal fun CompactSettings(state: SubscriptionSettingsState, onUpgrade: () -> Unit) {
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
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TierBadge(state.tier, size = 28.dp)
        Text(state.statusLabel, style = MaterialTheme.typography.bodyLarge)
        Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            state.supportingText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (action != null) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
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
    state: SubscriptionSettingsState,
    copy: SubscriptionSettingsCopy,
    onUpgrade: () -> Unit,
    render: @Composable (label: String, tag: String, onClick: () -> Unit) -> Unit,
) {
    when {
        state.tier == EntitlementTier.FREE ->
            render(copy.upgradeLabel, PayCraftTestTags.SUBSCRIPTION_UPGRADE_ROW, onUpgrade)
        state.canManage ->
            render(copy.manageLabel, PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW, state.onManage)
        else -> Unit
    }
}

@Composable
private fun StatusBlock(state: SubscriptionSettingsState) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW),
    ) {
        Text(state.statusLabel, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(2.dp))
        Text(
            state.supportingText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TappableRow(label: String, tag: String, onClick: () -> Unit) {
    Text(
        text = label,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            // >=48dp (NFR-010): a row people tap in order to cancel must not be fiddly.
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    )
}

/** Tier mark. Theme colours only — no brand assets, so it inherits the host's palette. */
@Composable
private fun TierBadge(tier: EntitlementTier, size: androidx.compose.ui.unit.Dp) {
    val bg = when (tier) {
        EntitlementTier.FREE -> MaterialTheme.colorScheme.surfaceVariant
        EntitlementTier.TRIAL -> MaterialTheme.colorScheme.secondaryContainer
        EntitlementTier.PREMIUM -> MaterialTheme.colorScheme.tertiaryContainer
    }
    Surface(shape = RoundedCornerShape(50), color = bg) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Default.Stars,
                contentDescription = null,
                modifier = Modifier.size(size * 0.55f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
