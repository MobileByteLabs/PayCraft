package com.mobilebytelabs.paycraft.persistence

import com.russhwolf.settings.Settings

/**
 * Once-per-(session × SKU) flag for [com.mobilebytelabs.paycraft.ui.PayCraftCheckoutSuccessSheet].
 *
 * Keyed `paycraft_success_shown_{sku}_{session_id}`. A "session" here is the
 * consumer app's notion of session (typically derived from process start or
 * a UUID generated at first launch); cmp-paycraft doesn't impose a definition.
 *
 * Persisted via [multiplatform-settings](https://github.com/russhwolf/multiplatform-settings)
 * — the same dependency [com.mobilebytelabs.paycraft.config.ConfigCache] and
 * [com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore] use, so no
 * new dependency is added by cmp-paycraft 2.1.0.
 *
 * Internal because consumer apps don't author this directly — they pass an
 * `activatedSku + sessionId` pair to [com.mobilebytelabs.paycraft.ui.
 * PayCraftCheckoutSuccessSheet] and the sheet consults this flag.
 */
internal class CheckoutSuccessFlag(private val settings: Settings) {

    fun wasSuccessShown(sku: String, sessionId: String): Boolean = settings.getBoolean(keyFor(sku, sessionId), false)

    fun markSuccessShown(sku: String, sessionId: String) {
        settings.putBoolean(keyFor(sku, sessionId), true)
    }

    private fun keyFor(sku: String, sessionId: String): String = "paycraft_success_shown_${sku}_$sessionId"

    companion object {
        /**
         * Returns a [CheckoutSuccessFlag] backed by a default [Settings]
         * instance — the same delegate pattern [PayCraftSettingsStore] uses.
         * Tests can inject a [com.russhwolf.settings.MapSettings] directly.
         */
        fun get(): CheckoutSuccessFlag = CheckoutSuccessFlag(Settings())
    }
}
