/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.ResolvedRegion
import com.mobilebytelabs.paycraft.core.MonetizationMode

/**
 * The REMOTE/config surface — what a consumer injects in its **`core/network`** layer.
 *
 * ## Three facades, one per consumer layer
 *
 * The SDK exposes exactly three injectable surfaces, and they line up with the layers a KMP
 * consumer already has. Nothing else is public API; the rest is the SDK's to manage.
 *
 * | facade | consumer layer | answers |
 * |---|---|---|
 * | `PayCraftApi` | `core/network` | how is this app configured, where is the buyer, refresh from the server |
 * | [PayCraftRepository] | `core/data` | what does THIS USER have, let them transact, drive the paywall |
 * | [com.mobilebytelabs.paycraft.persistence.PayCraftStore] | `core/store` | what is cached on this device |
 *
 * Mapping them onto the layers a consumer already has is the point: an app does not have to invent
 * a place to put billing, and a reviewer can tell at a glance whether a call sits in the right one.
 * A feature module that reaches for `PayCraftApi` is reaching past its data layer, which is now
 * visible rather than a matter of taste.
 *
 * ## Why these members and not the rest of the singleton
 *
 * `object PayCraft` has 26 public members. Four are BOOTSTRAP and deliberately absent here:
 *
 * - `initialize` — called once, by the host's own startup wiring. A feature module that can
 *   re-initialize the SDK can repoint it at another tenant mid-session.
 * - `requireConfig` — throws when config has not landed; the flows below degrade instead.
 * - `billingManager` — the internal engine. Exposing it re-opens every surface this facade narrows.
 * - `deviceId` — device identity is the SDK's to resolve; a host reading it starts keying its own
 *   state on it, and the two notions then drift.
 *
 * Everything else a consumer legitimately needs is on one of the two facades, which is what the
 * `G-PAYCRAFT-FACADE-COVERAGE` gate asserts — before it existed, `manageSubscriptionUrl` was added
 * to the singleton and to no facade, and cappy wrote a delegate file to reach it.
 */
interface PayCraftApi {

    // ── Setup ────────────────────────────────────────────────────────────────────────────────────

    /**
     * Whether this app has a usable publishable key.
     *
     * `false` is NOT an error state: an app whose tenant has not been provisioned yet runs
     * local-first with every gate reading free. Branch on this to hide billing UI entirely rather
     * than showing a paywall that cannot transact.
     */
    val isConfigured: Boolean

    /**
     * Test or live, derived from the ARTIFACT (`PlatformInfo.buildKind`), never declared by a host.
     *
     * Read it to label a debug build; never branch billing logic on it. The SDK already picks the
     * key tier from this same signal, so a host re-deciding can only disagree with it — which is
     * exactly how a debug build came to ship the live key.
     */
    val mode: PayCraft.Mode

    /** Subscription-first, ad-supported, or hybrid — the tenant's published monetization shape. */
    val monetizationMode: MonetizationMode

    // ── Where the user is ────────────────────────────────────────────────────────────────────────

    /**
     * Resolved country + currency, as one object.
     *
     * Use for DISPLAY (a "prices in ₹" note, a region picker). Never compute a price from it: the
     * authoritative amount is on the plan, already resolved per-country server-side. Deriving a
     * price locally from a currency code is how a ¥400 plan became ¥32,900.
     */
    val activeRegion: ResolvedRegion

    /** ISO-3166 alpha-2 of the resolved buyer country. */
    val activeCountry: String

    /** ISO-4217 of the resolved buyer currency. */
    val activeCurrency: String

    // ── Remote refresh ───────────────────────────────────────────────────────────────────────────

    /**
     * Re-fetch the tenant's `/config`.
     *
     * Rarely needed explicitly: the SDK refreshes on its own schedule. Call it after an operator
     * changes the paywall and wants it live without an app restart.
     */
    fun refreshConfig()

    /**
     * Warm the native store's product cache.
     *
     * Suspending because it round-trips to the store. Worth calling before a paywall opens so the
     * first render has prices rather than placeholders.
     */
    suspend fun prefetchProducts()
}
