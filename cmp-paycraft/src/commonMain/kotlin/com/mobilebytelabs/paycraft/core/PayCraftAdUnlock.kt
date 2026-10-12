package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Time-boxed "watch an ad to unlock this feature" grants.
 *
 * A rewarded ad buys the viewer a WINDOW, not a one-shot: the grant survives process death and
 * expires on a wall-clock deadline. That is the contract [PayCraftRewardedGate] is built on.
 *
 * ## Why a window rather than a session or a use-count
 *
 * Session-scoped would silently re-gate the feature on the next cold start, so a viewer who watched
 * an ad a minute ago is asked again — the grant reads as broken rather than expired. A use-count
 * needs the host to tell the SDK when a use was consumed, which puts the accounting in the one place
 * that cannot be verified. A deadline is self-describing: it is either in the future or it is not.
 *
 * ## Persistence
 *
 * Keyed per feature (`paycraft.ad_unlock.{featureKey}` → expiry epoch-millis) in [Settings], the same
 * mechanism [com.mobilebytelabs.paycraft.config.ConfigCache] uses. Deliberately NOT added to
 * [com.mobilebytelabs.paycraft.persistence.PayCraftStore]: that is a consumer-implementable
 * interface, and widening it would break every existing implementor for a concern that is purely
 * SDK-internal.
 *
 * ## Clock
 *
 * Reads [currentTimeMillis], so a device clock moved BACKWARD extends a grant. That is the
 * acceptable direction to be wrong in: the alternative is a server round-trip to show a free feature,
 * and a user who sets their clock back to re-watch less advertising has gained an ad view, not money.
 * Entitlement itself is never decided here — only an ad grant.
 */
object PayCraftAdUnlock {

    internal const val KEY_PREFIX = "paycraft.ad_unlock."

    /** Default grant length. 24h is the industry-conventional rewarded window. */
    const val DEFAULT_UNLOCK_MILLIS: Long = 24L * 60L * 60L * 1000L

    private var settings: Settings = Settings()

    /**
     * Bumped on every grant/expiry so Compose recomposes. A plain `isUnlocked()` read cannot drive
     * recomposition on its own — nothing would tell the gate that a grant just landed.
     */
    private val _revision = MutableStateFlow(0L)
    val revision: StateFlow<Long> = _revision.asStateFlow()

    /** Replace the backing store. Used by [com.mobilebytelabs.paycraft.PayCraft] init and by tests. */
    internal fun bind(store: Settings) {
        settings = store
        _revision.value = _revision.value + 1
    }

    private fun key(featureKey: String) = "$KEY_PREFIX$featureKey"

    /**
     * Epoch-millis this feature's ad grant expires, or `null` when there is none.
     *
     * An EXPIRED row is removed on read rather than left to accumulate — the store would otherwise
     * grow one dead key per feature the user ever unlocked.
     */
    fun expiresAt(featureKey: String): Long? {
        val at = settings.getLongOrNull(key(featureKey)) ?: return null
        if (at <= currentTimeMillis()) {
            settings.remove(key(featureKey))
            return null
        }
        return at
    }

    /** True while an unexpired ad grant covers [featureKey]. */
    fun isUnlocked(featureKey: String): Boolean = expiresAt(featureKey) != null

    /**
     * Record a reward. Call this ONLY from the host's rewarded-ad completion callback — granting on
     * ad *start* would unlock the feature for anyone who opens and dismisses an ad.
     *
     * Extends rather than overwrites: re-watching with time left should never SHORTEN the window.
     */
    fun grant(featureKey: String, durationMillis: Long = DEFAULT_UNLOCK_MILLIS) {
        require(durationMillis > 0) { "ad unlock duration must be positive, was $durationMillis" }
        val candidate = currentTimeMillis() + durationMillis
        val existing = expiresAt(featureKey)
        val expiry = if (existing != null && existing > candidate) existing else candidate
        settings.putLong(key(featureKey), expiry)
        _revision.value = _revision.value + 1
        PayCraftLogger.onFlow("adUnlock", "granted $featureKey until $expiry (durationMillis=$durationMillis)")
    }

    /** Drop a grant — e.g. the host revoking a reward it could not verify. */
    fun revoke(featureKey: String) {
        settings.remove(key(featureKey))
        _revision.value = _revision.value + 1
        PayCraftLogger.onFlow("adUnlock", "revoked $featureKey")
    }

    /**
     * Drop EVERY ad grant.
     *
     * Clears the keys rather than swapping in a fresh [Settings] handle — on JVM/Android a `Settings()`
     * is backed by a PERSISTENT store (java.util.prefs / SharedPreferences), so re-binding a new
     * handle points at the same rows and clears nothing. An earlier version did exactly that and
     * grants leaked between tests: one test granted an unlock and a later test found its feature
     * already open, so a gate that should have prompted silently served the content.
     *
     * Also the honest implementation of "forget all rewards" for a host that needs it (sign-out,
     * account switch), which is why it is not test-only in behaviour.
     */
    fun clearAll() {
        settings.keys
            .filter { it.startsWith(KEY_PREFIX) }
            .forEach { settings.remove(it) }
        _revision.value = _revision.value + 1
    }

    internal fun resetForTest() {
        clearAll()
        _revision.value = 0L
    }
}
