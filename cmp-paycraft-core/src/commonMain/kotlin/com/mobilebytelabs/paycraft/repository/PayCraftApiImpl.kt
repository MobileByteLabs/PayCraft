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
 * [PayCraftApi] over the singleton.
 *
 * Deliberately a thin delegation with NO state of its own. The singleton already owns the config
 * flows, the resolved region and the paywall presentation state; re-deriving any of it here would
 * create a second source of the same truth that can disagree with the SDK's own surfaces — the
 * defect class that produced both the `isPremium` / `billingState` split and the
 * `trial_duration_days` / `trial_per_platform` split.
 *
 * Every member reads through on each access rather than caching, because the singleton's values
 * change when `/config` lands and a snapshot taken at construction would be stale for the life of
 * the Koin singleton.
 */
internal class PayCraftApiImpl : PayCraftApi {

    override val isConfigured: Boolean get() = PayCraft.isConfigured

    override val mode: PayCraft.Mode get() = PayCraft.mode

    override val monetizationMode: MonetizationMode get() = PayCraft.monetizationMode

    override val activeRegion: ResolvedRegion get() = PayCraft.activeRegion

    override val activeCountry: String get() = PayCraft.activeCountry

    override val activeCurrency: String get() = PayCraft.activeCurrency

    override fun refreshConfig() = PayCraft.refreshConfig()

    override suspend fun prefetchProducts() = PayCraft.prefetchProducts()
}
