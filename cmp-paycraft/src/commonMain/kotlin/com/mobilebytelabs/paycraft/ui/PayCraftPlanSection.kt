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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.core.SyncPolicy
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_get_premium
import com.mobilebytelabs.paycraft.generated.resources.paycraft_manage_subscription
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_button
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_expires_on
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_free
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_free_supporting
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_premium
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_premium_supporting
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_renews_on
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_trial
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_trial_days_left
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_trial_ending_today
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_trial_one_day_left
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_trial_supporting
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

/**
 * The subscription section of a host's Settings screen — status, manage, restore — resolved from
 * live entitlement.
 *
 * ## Why this is in the SDK
 *
 * Every consumer rebuilds it. Measured on `mbs/cappy` 2026-10-16: 67 subscription-related lines in
 * a 411-line settings ViewModel, plus the section UI, plus its own `EntitlementTier -> String`
 * mapping. The pieces were already HERE — [PayCraftRestore] ships the restore flow, [PayCraftPlanBanner]
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
 * [PayCraftPlanSection] draws the whole section, and that is the only entry point. The
 * computed state below is INTERNAL on purpose.
 *
 * An earlier draft exposed it so a host could draw the rows itself. That inverted the point: handing
 * a consumer `statusLabel` / `canManage` / `onManage` and asking them to assemble a section is the
 * work they were already doing, minus a tier `when`. The actual objection to an SDK-drawn row is
 * that it looks foreign in someone else's list — which is a THEMING problem, so
 * [PayCraftPlanSectionTheme] solves it instead. Its defaults read from the ambient `MaterialTheme`, so
 * a host that themes its app at all already gets its own palette, shape and type here.
 */
@Immutable
internal data class PlanSectionState(
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
    /**
     * Shows the SDK's restore flow.
     *
     * Just the trigger. It used to be accompanied by `restoreVisible` + `onRestoreDismiss`, which
     * made every caller of this state own the sheet's visibility; [rememberRestorePresenter] now
     * emits the sheet and hands back only this, so there is one place in the SDK where restore is
     * presented rather than one per surface that offers it.
     */
    val onRestoreClick: () -> Unit,
)

/**
 * Compute [PlanSectionState] from live entitlement.
 *
 * @param repository the data facade. Nullable with a Koin fallback resolved INSIDE the body, never
 *   as a default argument: a default is evaluated at the CALL SITE, so `repository: PayCraftRepository
 *   = koinInject()` would inject even when the caller never uses the result — the exact defect
 *   [PayCraftRestore] documents, which broke every `@Preview` of a host screen containing one.
 *   Internal, and a test seam only: a consumer never supplies this, because the SDK owning its own
 *   data access is the reason the facades exist.
 * @param copy resolved wording — see [rememberSettingsCopy], which merges the tenant's dashboard
 *   values over the SDK's bundled strings.
 */
@Composable
internal fun rememberSubscriptionSettingsState(
    repository: PayCraftRepository? = null,
    copy: PlanSectionCopy,
): PlanSectionState {
    val repo = repository ?: koinInject()
    val entitlement by repo.entitlement.collectAsState()
    val status by repo.subscriptionStatus.collectAsState()
    val showRestore = rememberRestorePresenter()

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

    return PlanSectionState(
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
        onRestoreClick = showRestore,
    )
}

/**
 * Resolved wording for the subscription section.
 *
 * ## Why this is internal and server-sourced
 *
 * It shipped as a PUBLIC type with English defaults, overridable by the host. That made the strings
 * hardcoded one layer lower rather than configurable: renaming "Premium" to "Cappy Pro" was an app
 * release, while the same word on the paywall is a dashboard edit — two sources of truth for one
 * product's vocabulary, which is how an app ends up calling the same tier two different things on
 * two screens.
 *
 * So the copy comes from the dashboard, through [PaywallDto]'s `settings_*` fields (migration 156),
 * and this type is the resolved RESULT rather than an input. There is nothing for a consumer to
 * pass.
 *
 * ## Templates, not lambdas
 *
 * The three variable lines hold a TEMPLATE with a `{days}` / `{date}` token and substitute in a
 * method, where the earlier public version held `(Long) -> String` lambdas. A lambda cannot come off
 * a wire, and it also made `@Immutable` a lie. Tokens are the convention migration 077 set for
 * `trial_terms_template`, so server-authored copy works the same way everywhere.
 */
@Immutable
internal data class PlanSectionCopy(
    val freeLabel: String,
    val trialLabel: String,
    val premiumLabel: String,
    val freeSupporting: String,
    val trialSupporting: String,
    val trialEndingToday: String,
    /** Exactly one day left. Its own field because no token substitution can pluralise. */
    val trialOneDayLeft: String,
    /** Token `{days}`. */
    val trialDaysLeftTemplate: String,
    val premiumSupporting: String,
    /** Token `{date}`. */
    val renewsOnTemplate: String,
    /** Token `{date}`. */
    val expiresOnTemplate: String,
    val manageLabel: String,
    val upgradeLabel: String,
    val restoreLabel: String,
) {
    fun trialDaysLeft(days: Long): String = trialDaysLeftTemplate.replace(TOKEN_DAYS, days.toString())
    fun renewsOn(date: String): String = renewsOnTemplate.replace(TOKEN_DATE, date)
    fun expiresOn(date: String): String = expiresOnTemplate.replace(TOKEN_DATE, date)

    internal companion object {
        const val TOKEN_DAYS = "{days}"
        const val TOKEN_DATE = "{date}"
    }
}

/**
 * The tenant's dashboard copy laid over the SDK's bundled strings (the receiver).
 *
 * Blank means "this tenant has not configured it", never "render nothing" — so an un-configured
 * tenant gets the SDK's own localised strings instead of English baked into a database column. That
 * is why migration 156 defaults those columns to `''` rather than to English the way the earlier
 * copy columns did.
 *
 * Every field follows the SAME two rungs — the tenant's `settings_*` value, then the bundled
 * string. An earlier version let [PlanSectionCopy.upgradeLabel] and
 * [PlanSectionCopy.restoreLabel] fall through the tenant's PAYWALL equivalent first, so an
 * app that renamed its paywall CTA to "Go Pro" would inherit it here for free.
 *
 * That was wrong, and a test caught it: `PaywallDto.restoreLabel` and `ctaGetPremium` default to
 * NON-BLANK English, and the server always sends them (their columns have carried English defaults
 * since migration 071). The middle rung therefore always hit, making the bundled rung — the
 * LOCALISED one — unreachable for those two fields. A French app would have shown English "Restore
 * Your Premium" in its settings while every other label was translated.
 *
 * A tenant who wants different settings wording types it in the settings field. One rule, no
 * exceptions, and localisation survives.
 */
internal fun PlanSectionCopy.mergedWith(paywall: PaywallDto) = PlanSectionCopy(
    freeLabel = paywall.settingsFreeLabel.ifBlank { freeLabel },
    trialLabel = paywall.settingsTrialLabel.ifBlank { trialLabel },
    premiumLabel = paywall.settingsPremiumLabel.ifBlank { premiumLabel },
    freeSupporting = paywall.settingsFreeSupporting.ifBlank { freeSupporting },
    trialSupporting = paywall.settingsTrialSupporting.ifBlank { trialSupporting },
    trialEndingToday = paywall.settingsTrialEndingToday.ifBlank { trialEndingToday },
    trialOneDayLeft = paywall.settingsTrialOneDayLeft.ifBlank { trialOneDayLeft },
    trialDaysLeftTemplate = paywall.settingsTrialDaysLeft.ifBlank { trialDaysLeftTemplate },
    premiumSupporting = paywall.settingsPremiumSupporting.ifBlank { premiumSupporting },
    renewsOnTemplate = paywall.settingsRenewsOn.ifBlank { renewsOnTemplate },
    expiresOnTemplate = paywall.settingsExpiresOn.ifBlank { expiresOnTemplate },
    manageLabel = paywall.settingsManageLabel.ifBlank { manageLabel },
    upgradeLabel = paywall.settingsUpgradeLabel.ifBlank { upgradeLabel },
    restoreLabel = paywall.settingsRestoreLabel.ifBlank { restoreLabel },
)

/**
 * Bundled strings, then the tenant's dashboard copy over the top.
 *
 * Manage / Upgrade / Restore reuse the existing paywall strings rather than introducing settings
 * variants: an app should not say "Restore Your Premium" on its paywall and "Restore purchases" in
 * its settings.
 */
@Composable
internal fun rememberSettingsCopy(): PlanSectionCopy {
    // stringResource must be read in composition, so every fallback resolves up front — which is
    // also why the type holds templates: a `(Long) -> String` lambda could not call stringResource
    // from inside the non-composable function type the renderers invoke it through.
    val bundled = PlanSectionCopy(
        freeLabel = stringResource(Res.string.paycraft_settings_free),
        trialLabel = stringResource(Res.string.paycraft_settings_trial),
        premiumLabel = stringResource(Res.string.paycraft_settings_premium),
        freeSupporting = stringResource(Res.string.paycraft_settings_free_supporting),
        trialSupporting = stringResource(Res.string.paycraft_settings_trial_supporting),
        trialEndingToday = stringResource(Res.string.paycraft_settings_trial_ending_today),
        trialOneDayLeft = stringResource(Res.string.paycraft_settings_trial_one_day_left),
        trialDaysLeftTemplate = stringResource(Res.string.paycraft_settings_trial_days_left),
        premiumSupporting = stringResource(Res.string.paycraft_settings_premium_supporting),
        renewsOnTemplate = stringResource(Res.string.paycraft_settings_renews_on),
        expiresOnTemplate = stringResource(Res.string.paycraft_settings_expires_on),
        manageLabel = stringResource(Res.string.paycraft_manage_subscription),
        upgradeLabel = stringResource(Res.string.paycraft_get_premium),
        restoreLabel = stringResource(Res.string.paycraft_restore_button),
    )
    val paywall = PayCraft.suiteConfigFlow.collectAsState().value?.paywall
    // Null until the first config lands, and on every offline cold start with no cache. The section
    // renders in the host's language either way rather than waiting on a network round trip.
    return remember(bundled, paywall) { paywall?.let(bundled::mergedWith) ?: bundled }
}

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
 * a worse answer than a stable unambiguous format. A tenant who needs a different shape controls the
 * surrounding sentence through `settings_renews_on`.
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
 * PayCraftPlanSection(header = { SectionHeader("Subscription") })
 * ```
 *
 * Every parameter is presentation. The wording comes from the dashboard, the data from the SDK's
 * own facades, and both actions — Manage and Upgrade — are resolved internally, so there is no
 * copy, repository or callback to pass. That is the point of the component existing at all: it is
 * a VIEW of live subscription state, not a kit for assembling one.
 *
 * @param style one of five presets. [PayCraftPlanSectionStyle.Rows] suits a conventional settings
 *   list; the others exist for hosts whose settings screen is not a list.
 * @param theme design tokens. Defaults to the app-wide theme supplied via
 *   [ProvidePayCraftPlanSectionTheme], falling back to the ambient `MaterialTheme`. Pass one here
 *   only for a screen that differs from the app-wide answer — otherwise provide it once and let
 *   every surface pick it up.
 * @param header drawn above the rows when the section is visible. Omitted when it is not, so a host
 *   never renders a heading over nothing. The only slot, because a heading is the host's own
 *   typography — its casing, colour and leading — and no theme token expresses that.
 */
@Composable
fun PayCraftPlanSection(
    modifier: Modifier = Modifier,
    style: PayCraftPlanSectionStyle = PayCraftPlanSectionStyle.Rows,
    theme: PayCraftPlanSectionTheme = rememberPayCraftPlanSectionTheme(),
    header: (@Composable () -> Unit)? = null,
) {
    // The configured check comes FIRST, before anything resolves from Koin.
    //
    // It used to live inside the state function, AFTER `repository ?: koinInject()` — so merely
    // HAVING this section on a screen required a started Koin graph, and every @Preview and
    // Roborazzi capture of a host screen containing one died with "KoinApplication has not been
    // started". cappy's settings preview test caught it the day this was adopted.
    //
    // This is the SAME defect [PayCraftRestore] documents and fixed the same way: check the cheap
    // thing that can short-circuit, and only then reach for DI. It is also the correct PRODUCTION
    // order — an app with no publishable key has no billing to resolve, so resolving one is work
    // done to render nothing.
    if (!PayCraft.isConfigured) return

    val copy = rememberSettingsCopy()
    val state = rememberSubscriptionSettingsState(copy = copy)
    if (!state.visible) return

    // Where a free user's tap goes is NOT a host decision. An earlier version took an `onUpgrade`
    // callback so a host could route somewhere of its own — but the SDK owns the paywall, which is
    // dashboard-configured, so a host overriding it is a host rebuilding what it just adopted. The
    // same reasoning that removed `copy` and `repository`: if the SDK has the answer, it does not
    // ask. Manage already worked this way — it has never been overridable.
    val upgrade: () -> Unit = { PayCraft.presentPaywall() }

    Column(modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.SUBSCRIPTION_SETTINGS)) {
        // Compact is a single inline row by definition — a section header above a one-liner is the
        // thing it exists to avoid, so it does not get one.
        if (style != PayCraftPlanSectionStyle.Compact) header?.invoke()

        when (style) {
            PayCraftPlanSectionStyle.Minimal -> MinimalSettings(state, copy, theme, upgrade)
            PayCraftPlanSectionStyle.Rows -> RowsSettings(state, copy, theme, upgrade)
            PayCraftPlanSectionStyle.Card -> CardSettings(state, copy, theme, upgrade)
            PayCraftPlanSectionStyle.Hero -> HeroSettings(state, copy, theme, upgrade)
            PayCraftPlanSectionStyle.Compact -> CompactSettings(state, theme, upgrade)
        }
    }
}
