/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.persistence

import com.mobilebytelabs.paycraft.model.SubscriptionStatus

/**
 * Everything PayCraft keeps on THIS DEVICE — what a consumer injects in its **`core/store`** layer.
 *
 * The third of the SDK's three injectable facades, one per consumer layer:
 * [com.mobilebytelabs.paycraft.repository.PayCraftApi] (`core/network`),
 * [com.mobilebytelabs.paycraft.repository.PayCraftRepository] (`core/data`), and this one.
 *
 * ## Read it; think hard before writing it
 *
 * Most apps never call this. The SDK writes it, and [PayCraftRepository] already exposes the
 * resulting state as flows — which are offline-tolerant precisely BECAUSE this cache exists.
 * Reach for this when you need to answer "what is on this device right now" without a flow
 * subscription: a cold-start branch, a diagnostics screen, a sign-out wipe.
 *
 * Writing it directly means asserting an entitlement the server has not confirmed. The one write
 * a host legitimately owns is [clearAll] on sign-out.
 *
 * ## Why these members, and why they all have defaults
 *
 * This is a HOST-IMPLEMENTABLE interface: an app may supply its own storage (an existing DataStore,
 * an encrypted DB). Adding abstract members would break every such implementation on upgrade, so
 * every member added here carries a default that preserves the previous behaviour. The three
 * identity members have no default because an implementation that cannot store an email is not a
 * store at all — those were the original contract.
 *
 * The ad-unlock and device-token members default to the SDK's own in-memory/settings behaviour by
 * returning "nothing stored", which is the same answer a host that ignores them gave before they
 * existed.
 */
interface PayCraftStore {

    // ── Identity ─────────────────────────────────────────────────────────────────────────────────

    suspend fun saveEmail(email: String)
    suspend fun getEmail(): String?
    suspend fun clearEmail()

    // ── Subscription cache ───────────────────────────────────────────────────────────────────────
    //
    // Non-suspend on purpose: the billing manager reads these during construction to resolve an
    // entitlement before the first frame. A suspending read there would mean a cold start renders
    // as free for a paying customer.

    fun cacheSubscriptionStatus(status: SubscriptionStatus) {}
    fun getCachedSubscriptionStatus(): SubscriptionStatus? = null
    fun getLastSyncedAt(): Long = 0L
    fun clearCache() {}

    // ── Ad-unlock grants ─────────────────────────────────────────────────────────────────────────
    //
    // A rewarded-ad unlock is a time-boxed, per-feature grant. It lives here rather than in the
    // subscription cache because it is NOT an entitlement: it expires on a wall clock, it is
    // per-featureKey, and it must survive a process restart or the user re-watches an ad they
    // already sat through.

    /** Epoch millis this feature's ad grant expires, or `null` when there is none. */
    fun getAdUnlockExpiry(featureKey: String): Long? = null

    /** Record a grant. [expiresAtEpochMillis] is absolute, not a duration, so a restart cannot extend it. */
    fun saveAdUnlock(featureKey: String, expiresAtEpochMillis: Long) {}

    /** Drop one grant. */
    fun clearAdUnlock(featureKey: String) {}

    /** Every live grant, for a diagnostics view or a bulk wipe. */
    fun getAllAdUnlocks(): Map<String, Long> = emptyMap()

    // ── Device token ─────────────────────────────────────────────────────────────────────────────
    //
    // Identifies this installation to the backend when there is no email. Stable across launches,
    // which is what makes an anonymous purchase restorable on the same device.

    fun getDeviceToken(): String? = null
    fun saveDeviceToken(token: String) {}
    fun clearDeviceToken() {}

    // ─── Consumable drain intent ─────────────────────────────────────────────
    //
    // A purchased balance is moved to the host in two writes against different systems (debit the
    // server, then credit the host), and a crash between them is the ordinary case. The intent is
    // persisted BEFORE the server is touched so the next launch can replay it under the same id.
    // Defaulted no-ops: a store that does not implement these simply loses crash-resume, it does
    // not break — and every existing implementation keeps compiling.

    /** Record an in-flight consumable drain. Overwrites any previous one (they are serialized). */
    fun saveConsumablePending(grantId: String, sku: String, quantity: Int) {}

    /** The in-flight drain, or null. */
    fun getConsumablePending(): ConsumablePending? = null

    /** Clear the in-flight drain once the host has durably credited it. */
    fun clearConsumablePending() {}

    // ── Wipe ─────────────────────────────────────────────────────────────────────────────────────

    /**
     * Clear everything this store holds — identity, subscription cache, ad grants, device token.
     *
     * The sign-out call. Defaults to the pieces an older implementation already had, so a host that
     * has not overridden it still wipes what it actually stores rather than silently wiping nothing.
     * A host with its own storage should override this and mean it: a sign-out that leaves a cached
     * entitlement behind shows the next user the previous user's premium state.
     */
    suspend fun clearAll() {
        clearEmail()
        clearCache()
        clearDeviceToken()
        getAllAdUnlocks().keys.forEach { clearAdUnlock(it) }
    }
}

/**
 * An in-flight consumable drain: the server may or may not already be debited, and the host may or
 * may not already have credited. Replaying under [grantId] settles it either way.
 */
public data class ConsumablePending(val grantId: String, val sku: String, val quantity: Int)
