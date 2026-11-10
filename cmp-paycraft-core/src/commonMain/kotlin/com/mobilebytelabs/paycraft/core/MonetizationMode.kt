/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * MonetizationMode — the two first-class monetization policies + the config-wins
 * resolver + the auxiliary state carriers (AdFreeEntitlement, SessionDebounce,
 * EntitlementSnapshot, TrialSnapshot, PaywallPresentation) that Phase-4 needs to
 * dispatch the paywall on app-open (AC-9..AC-12).
 *
 * Placed under `core/` (not `config/`) because these types drive PayCraft.kt's
 * runtime behaviour (auto-present dispatch, ad-free flag) rather than being pure
 * serialization DTOs. The [MonetizationMode] enum itself IS @Serializable so it
 * round-trips through the cloud [com.mobilebytelabs.paycraft.config.SuiteConfig].
 */
package com.mobilebytelabs.paycraft.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Monetization policy for the PayCraft SDK — decides *when* and *how* the paywall
 * is presented (AC-9). Set once at [com.mobilebytelabs.paycraft.PayCraft.initialize]
 * time as the default; overridable by cloud [com.mobilebytelabs.paycraft.config.SuiteConfig.mode]
 * per the config-wins precedence [MonetizationModeResolver] enforces (mirrors the
 * theme pipeline — dashboard `theme_jsonb` / `primary_color` overrides the init
 * theme default the same way).
 *
 * ─ [AdSupported] — the SDK never auto-presents the paywall. Hosts trigger
 *   [com.mobilebytelabs.paycraft.PayCraft.presentPaywall] manually (contextual;
 *   e.g. after an ad, on a settings tap). The SDK exposes
 *   [com.mobilebytelabs.paycraft.PayCraft.isAdFree] which mirrors the buyer's
 *   subscription status so the host can gate ad rendering (AC-12).
 *
 * ─ [TrialManaged] — the SDK auto-presents the paywall on
 *   [com.mobilebytelabs.paycraft.PayCraft.onAppOpen] when the buyer's trial is
 *   active (nudge the mid-trial conversion) OR when the trial has just ended
 *   (the convert-or-churn moment). Debounced once-per-process by
 *   [SessionDebounce] so a rapid app-open cycle does not re-present (AC-11).
 *   Never fires when the buyer is already premium or has never had a trial.
 *
 * The wire format uses lowercase-underscore (`"ad_supported"` / `"trial_managed"`)
 * so a dashboard column emitted as a plain string round-trips cleanly — kotlinx
 * default enum-serialization uses the exact case-sensitive constant name which
 * would leak a Kotlin-flavoured shape into the cloud contract.
 */
@Serializable
enum class MonetizationMode {
    @SerialName("ad_supported")
    AdSupported,

    @SerialName("trial_managed")
    TrialManaged,
}

/**
 * Config-wins precedence resolver (AC-9). Cloud [configMode] overrides the
 * host-supplied [initFlag] whenever the cloud config carries a mode, so a
 * dashboard flip propagates without a host rebuild — same design as the
 * unified theme pipeline (`SuiteConfig.paywall.themeJsonb`/`primaryColor`
 * overrides the host `MaterialTheme`).
 *
 * Called once from [com.mobilebytelabs.paycraft.PayCraft.initialize] (with
 * `configMode = null` at cold start when no SuiteConfig has been fetched yet)
 * and re-called from [com.mobilebytelabs.paycraft.PayCraft.applySuiteConfig]
 * every time a fresh SuiteConfig lands (with the cloud value if present).
 */
object MonetizationModeResolver {
    fun resolve(initFlag: MonetizationMode, configMode: MonetizationMode?): MonetizationMode = configMode ?: initFlag
}

/**
 * Ad-free entitlement flag readable by the host (AC-12). Mirrors the buyer's
 * subscription status (premium ⇒ ad-free) so an [MonetizationMode.AdSupported]
 * host can gate ad rendering off a single StateFlow without needing to reach
 * into [com.mobilebytelabs.paycraft.core.BillingManager] directly. Also updated
 * in [MonetizationMode.TrialManaged] so the same flag is the single source of
 * "user is paying" everywhere in the app.
 *
 * Populated by [com.mobilebytelabs.paycraft.PayCraft.onAppOpen] from the passed
 * [EntitlementSnapshot.isPremium]; hosts that observe entitlement changes
 * elsewhere (post-purchase webhook, subscription refresh) can push the update
 * via [set].
 */
object AdFreeEntitlement {
    private val _isAdFree = MutableStateFlow(false)

    /** Read-only StateFlow surfaced as `PayCraft.isAdFree` (AC-12). */
    val isAdFree: StateFlow<Boolean> = _isAdFree.asStateFlow()

    /** Push a fresh premium/ad-free snapshot into the flag. */
    fun set(value: Boolean) {
        _isAdFree.value = value
    }

    /** Test-only reset — clears the flag back to non-premium between tests. */
    internal fun resetForTest() {
        _isAdFree.value = false
    }
}

/**
 * Once-per-session debounce for auto-present triggers (AC-11). Keeps a
 * process-wide set of "shown" keys so a repeated app-open within the same
 * process does NOT re-present the paywall (would nag the user). Cleared on
 * process death (natural boundary) or via [resetForTest] between unit tests.
 */
object SessionDebounce {
    /** Debounce key stamped when the TrialManaged app-open paywall fires. */
    const val APP_OPEN_KEY: String = "trial_managed_app_open"

    private val shownKeys = mutableSetOf<String>()

    fun wasShown(key: String): Boolean = shownKeys.contains(key)

    fun mark(key: String) {
        shownKeys.add(key)
    }

    /** Test-only reset — drops every marked key so a new test starts clean. */
    internal fun resetForTest() {
        shownKeys.clear()
    }
}

/**
 * Snapshot of the buyer's entitlement state at app-open time. Hosts derive
 * this from [com.mobilebytelabs.paycraft.core.BillingManager.isPremium] and
 * the active subscription's plan sku; tests inject a fixed snapshot directly.
 *
 * Today PayCraft models a single "premium" entitlement (buyer either has an
 * active subscription or does not). The [activeEntitlements] set is derived
 * from [isPremium] on construction — a future multi-entitlement extension can
 * populate it explicitly and [isActive] will resolve per-entitlement without a
 * caller-side rewrite.
 */
data class EntitlementSnapshot(
    val isPremium: Boolean,
    val activeEntitlements: Set<String> = if (isPremium) setOf("premium") else emptySet(),
) {
    /** True when [entitlement] is currently active for this buyer. */
    fun isActive(entitlement: String): Boolean = activeEntitlements.contains(entitlement)
}

/**
 * Snapshot of the buyer's trial state at app-open time. Hosts derive this
 * from [com.mobilebytelabs.paycraft.core.BillingManager.isInTrial] +
 * [com.mobilebytelabs.paycraft.core.BillingManager.trialEndsAt]; tests inject
 * a fixed snapshot directly.
 *
 * [isActiveOrNearExpiry] is the sole gate [com.mobilebytelabs.paycraft.PayCraft.onAppOpen]
 * consults for TrialManaged auto-present dispatch (AC-11).
 */
data class TrialSnapshot(
    /** True while the current subscription is in its trial window. */
    val isActive: Boolean,
    /** True when a trial has already ended (server-observed `trial_end < now`). */
    val hasEnded: Boolean = false,
    /** Days left in the trial; null when not in a trial. */
    val daysRemaining: Int? = null,
) {
    /**
     * TrialManaged auto-present fires when:
     *   (a) the trial is active — nudge the mid-trial conversion, OR
     *   (b) the trial has just ended — the convert-or-churn moment.
     *
     * Does NOT fire when there was never a trial (isActive=false, hasEnded=false).
     * The debounce is applied downstream in [com.mobilebytelabs.paycraft.PayCraft.onAppOpen],
     * not here, so this stays a pure predicate on the snapshot.
     */
    val isActiveOrNearExpiry: Boolean get() = isActive || hasEnded

    companion object {
        /** Buyer has never had a trial — auto-present must NOT fire. */
        val None: TrialSnapshot = TrialSnapshot(isActive = false, hasEnded = false, daysRemaining = null)
    }
}

/**
 * Reactive paywall-presentation request signal. Hosts observe
 * [com.mobilebytelabs.paycraft.PayCraft.paywallPresentation] and render
 * [com.mobilebytelabs.paycraft.ui.PayCraftPaywallComposable] (typically in a
 * modal sheet) when the value is [Shown]; on dismiss the host calls
 * [com.mobilebytelabs.paycraft.PayCraft.dismissPaywall] to reset to [Hidden].
 *
 * Modelled as a StateFlow rather than an imperative "present now" call because
 * the SDK is Compose-multiplatform: there is no UIKit-style modal presentation
 * primitive in commonMain — the host owns the composition tree, and observing
 * a StateFlow is the idiom that works across every KMP target.
 */
sealed interface PaywallPresentation {
    /** No paywall requested. Host renders nothing (or dismisses the current sheet). */
    data object Hidden : PaywallPresentation

    /** Paywall should be shown; [trigger] disambiguates the caller for analytics/UX. */
    data class Shown(val trigger: Trigger, val entitlement: String? = null) : PaywallPresentation {
        enum class Trigger {
            /** Host invoked [com.mobilebytelabs.paycraft.PayCraft.presentPaywall] (contextual). */
            Manual,

            /**
             * Host invoked [com.mobilebytelabs.paycraft.PayCraft.presentPaywallIfNeeded]
             * and the entitlement was NOT active (no-op path returned Hidden).
             */
            IfNeeded,

            /** TrialManaged mode auto-fired on app-open with an active-or-just-ended trial. */
            TrialManagedAppOpen,
        }
    }
}
