/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.SyncPolicy
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import org.koin.compose.koinInject

/**
 * The subscription section of a host's Settings screen — status, manage, restore — resolved from
 * live entitlement.
 *
 * ## Why this is in the SDK
 *
 * Every consumer rebuilds it. Measured on `mbs/cappy` 2026-10-16: 67 subscription-related lines in
 * a 411-line settings ViewModel, plus the section UI, plus its own `EntitlementTier -> String`
 * mapping. The pieces were already HERE — [PayCraftRestore] ships the restore flow, [PayCraftBanner]
 * the status card — and what was missing is the one thing a host actually wants: the section.
 *
 * cappy's tier mapping carried this comment:
 *
 * > the `when` is exhaustive with no `else`, deliberately: a tier the SDK adds later must be named
 * > here rather than silently rendering the free copy to a paying subscriber.
 *
 * That is a consumer defending itself against an SDK change it should never have to know about.
 * Adding a tier should not be a breaking change for every app that shows a settings row.
 *
 * ## One way in
 *
 * [PayCraftSubscriptionSettings] draws the whole section, and that is the only entry point. The
 * computed state below is INTERNAL on purpose.
 *
 * An earlier draft exposed it so a host could draw the rows itself. That inverted the point: handing
 * a consumer `statusLabel` / `canManage` / `onManage` and asking them to assemble a section is the
 * work they were already doing, minus a tier `when`. The actual objection to an SDK-drawn row is
 * that it looks foreign in someone else's list — which is a THEMING problem, so
 * [PayCraftSettingsTheme] solves it instead. Its defaults read from the ambient `MaterialTheme`, so
 * a host that themes its app at all already gets its own palette, shape and type here.
 */
@Immutable
internal data class SubscriptionSettingsState(
    /**
     * Whether a billing section should appear AT ALL.
     *
     * `false` when the app has no publishable key — an unprovisioned tenant runs local-first, and a
     * "Manage subscription" row that cannot transact is worse than no row. Branch on this to omit
     * the whole section including its header.
     */
    val visible: Boolean,
    /** `Free` / `Trial` / `Premium` — the tier itself, for a host that wants its own wording. */
    val tier: EntitlementTier,
    /** Short status, e.g. "Premium". Safe to render directly. */
    val statusLabel: String,
    /**
     * The supporting line: "Free plan — no active subscription", "Trial — 6 days left",
     * "Renews 14 Nov", or "Expires 14 Nov" when the subscription will not renew.
     *
     * A host that renders this never has to know which tier produced it.
     */
    val supportingText: String,
    /**
     * Whether a "Manage subscription" affordance should be shown.
     *
     * `false` when there is nowhere to send this user — a desktop or web build with no store page
     * and no provider portal. Rendering a row that does nothing when tapped is the failure this
     * flag exists to prevent.
     */
    val canManage: Boolean,
    /** Opens the provider portal or the platform's store subscriptions page. */
    val onManage: () -> Unit,
    /** Shows the SDK's restore flow. Observe [restoreVisible] to render it. */
    val onRestoreClick: () -> Unit,
    /** True while the restore sheet should be on screen. */
    val restoreVisible: Boolean,
    /** Dismiss the restore flow. */
    val onRestoreDismiss: () -> Unit,
)

/**
 * Compute [SubscriptionSettingsState] from live entitlement.
 *
 * @param repository the data facade. Nullable with a Koin fallback resolved INSIDE the body, never
 *   as a default argument: a default is evaluated at the CALL SITE, so `repository: PayCraftRepository
 *   = koinInject()` would inject even when the caller never uses the result — the exact defect
 *   [PayCraftRestore] documents, which broke every `@Preview` of a host screen containing one.
 * @param copy wording. Defaults are English; a host that localises supplies its own. Dashboard-driven
 *   copy is deliberately NOT read here yet — see the note on [SubscriptionSettingsCopy].
 */
@Composable
internal fun rememberSubscriptionSettingsState(
    repository: PayCraftRepository? = null,
    copy: SubscriptionSettingsCopy = SubscriptionSettingsCopy(),
): SubscriptionSettingsState {
    val repo = repository ?: koinInject()
    val entitlement by repo.entitlement.collectAsState()
    val status by repo.subscriptionStatus.collectAsState()
    var restoreVisible by remember { mutableStateOf(false) }

    // Read through on each composition rather than remembering: `isConfigured` and the manage URL
    // both resolve from config that lands asynchronously, so a value captured once would be stale
    // for the life of the screen.
    val configured = PayCraft.isConfigured
    val manageUrl = repo.manageSubscriptionUrl()

    val supporting = when (entitlement.tier) {
        EntitlementTier.FREE -> copy.freeSupporting
        EntitlementTier.TRIAL -> {
            val days = daysUntil(entitlement.trialEndsAt)
            when {
                days == null -> copy.trialSupporting
                days <= 0L -> copy.trialEndingToday
                days == 1L -> copy.trialOneDayLeft
                else -> copy.trialDaysLeft(days)
            }
        }
        // No `else`. A tier added later must be named here — in ONE place, inside the SDK, rather
        // than in every consumer's settings screen. That is the whole point of moving this in.
        EntitlementTier.PREMIUM -> {
            val date = status.expiresAt
            when {
                date == null -> copy.premiumSupporting
                status.willRenew -> copy.renewsOn(formatDate(date))
                else -> copy.expiresOn(formatDate(date))
            }
        }
    }

    return SubscriptionSettingsState(
        visible = configured,
        tier = entitlement.tier,
        statusLabel = when (entitlement.tier) {
            EntitlementTier.FREE -> copy.freeLabel
            EntitlementTier.TRIAL -> copy.trialLabel
            EntitlementTier.PREMIUM -> copy.premiumLabel
        },
        supportingText = supporting,
        canManage = manageUrl != null,
        onManage = { repo.manageSubscription() },
        onRestoreClick = { restoreVisible = true },
        restoreVisible = restoreVisible,
        onRestoreDismiss = { restoreVisible = false },
    )
}

/**
 * Wording for the subscription section.
 *
 * ## Why these are NOT read from the dashboard yet
 *
 * The paywall's copy comes from the published workflow, and this should too — otherwise the strings
 * are merely hardcoded one layer lower, and a host that localises still cannot. That needs a
 * `settings:` block in the tenant config, which is a backend change rather than a composable.
 *
 * Shipping English defaults first lets a consumer delete its mapping immediately instead of waiting
 * on a config schema. A localising host passes its own values today, and the dashboard-driven
 * version will populate the same type — so nothing a consumer writes now has to change.
 */
@Immutable
data class SubscriptionSettingsCopy(
    val freeLabel: String = "Free",
    val trialLabel: String = "Trial",
    val premiumLabel: String = "Premium",
    val freeSupporting: String = "Free plan — no active subscription",
    val trialSupporting: String = "Free trial active",
    val trialEndingToday: String = "Trial ends today",
    val trialOneDayLeft: String = "Trial — 1 day left",
    val trialDaysLeft: (Long) -> String = { "Trial — $it days left" },
    val premiumSupporting: String = "Subscription active",
    val renewsOn: (String) -> String = { "Renews $it" },
    val expiresOn: (String) -> String = { "Expires $it" },
    val manageLabel: String = "Manage subscription",
    val upgradeLabel: String = "Upgrade",
    val restoreLabel: String = "Restore purchases",
)

/**
 * Whole days from now until [iso], or `null` when it cannot be read.
 *
 * Reuses [SyncPolicy.parseExpiryToMillis] rather than parsing again: a second ISO parser in the
 * same SDK is a second thing to get wrong, and this one already handles the `Z` / `+00:00` /
 * fractional-second shapes the backend emits.
 */
internal fun daysUntil(iso: String?): Long? {
    val millis = SyncPolicy.parseExpiryToMillis(iso) ?: return null
    val remaining = millis - com.mobilebytelabs.paycraft.platform.currentTimeMillis()
    // Ceiling, not floor: with 36 hours left a user has "2 days", and rounding down to 1 makes the
    // app look like it is counting faster than the calendar.
    return if (remaining <= 0L) 0L else (remaining + DAY_MS - 1) / DAY_MS
}

private const val DAY_MS = 24L * 60 * 60 * 1000

/**
 * `2026-11-14T10:30:00Z` -> `14 Nov 2026`.
 *
 * Deliberately NOT locale-aware: commonMain has no date formatter, and inventing one here would be
 * a worse answer than a stable unambiguous format. A host that needs localised dates renders its
 * own from [SubscriptionSettingsState.tier] and the raw status.
 */
internal fun formatDate(iso: String): String {
    val date = iso.substringBefore('T').split('-')
    if (date.size != 3) return iso
    val month = date[1].toIntOrNull() ?: return iso
    val name = MONTHS.getOrNull(month - 1) ?: return iso
    return "${date[2].trimStart('0')} $name ${date[0]}"
}

private val MONTHS = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

/**
 * The drop-in subscription section: status line, Manage, Restore.
 *
 * Renders NOTHING when the app has no publishable key — including the header, so an unprovisioned
 * build shows no billing UI at all rather than a dead row.
 *
 * ```kotlin
 * // Settings screen
 * PayCraftSubscriptionSettings(header = { SectionHeader("Subscription") })
 * ```
 *
 * A host whose list has its own row components should use [rememberSubscriptionSettingsState]
 * instead and draw them itself — it still gets every label and decision, and an SDK-drawn row
 * inside someone else's list looks foreign no matter how it is styled.
 *
 * @param header drawn above the rows when the section is visible. Omitted when it is not, so a host
 *   never renders a heading over nothing.
 * @param onUpgrade optional: shown for a FREE user instead of Manage. `null` presents the SDK
 *   paywall, which is what most apps want; supply one to route somewhere specific.
 */
@Composable
fun PayCraftSubscriptionSettings(
    modifier: Modifier = Modifier,
    style: SubscriptionSettingsStyle = SubscriptionSettingsStyle.Rows,
    theme: PayCraftSettingsTheme = PayCraftSettingsTheme.defaults(),
    copy: SubscriptionSettingsCopy = SubscriptionSettingsCopy(),
    header: (@Composable () -> Unit)? = null,
    onUpgrade: (() -> Unit)? = null,
    repository: PayCraftRepository? = null,
) {
    val state = rememberSubscriptionSettingsState(repository, copy)
    if (!state.visible) return

    val upgrade: () -> Unit = { onUpgrade?.invoke() ?: PayCraft.presentPaywall() }

    Column(modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.SUBSCRIPTION_SETTINGS)) {
        // Compact is a single inline row by definition — a section header above a one-liner is the
        // thing it exists to avoid, so it does not get one.
        if (style != SubscriptionSettingsStyle.Compact) header?.invoke()

        when (style) {
            SubscriptionSettingsStyle.Minimal -> MinimalSettings(state, copy, theme, upgrade)
            SubscriptionSettingsStyle.Rows -> RowsSettings(state, copy, theme, upgrade)
            SubscriptionSettingsStyle.Card -> CardSettings(state, copy, theme, upgrade)
            SubscriptionSettingsStyle.Hero -> HeroSettings(state, copy, theme, upgrade)
            SubscriptionSettingsStyle.Compact -> CompactSettings(state, theme, upgrade)
        }
    }

    // The SDK's existing restore flow, not a second one. It owns the sheet, the provider buttons
    // and the calm non-blocking outcome notice. Rendered once here regardless of style.
    PayCraftRestore(visible = state.restoreVisible, onDismiss = state.onRestoreDismiss)
}
