package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.PayCraftPlatform

/**
 * Android default = the real Google Play Billing v8 client, auto-wired from the
 * Application context + foreground Activity that [PayCraftPlatform] captures via
 * `PayCraftInitializer`. This is what lets an Android consumer get native Play
 * Billing with ZERO androidMain wiring (no `paycraftPlayBillingModule`, no
 * activityProvider).
 *
 * Returns `null` only when the startup Initializer was disabled AND no manual
 * `PayCraftPlatform.init(...)` ran — then the caller falls back to web checkout.
 */
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? {
    val context = PayCraftPlatform.applicationContextOrNull() ?: return null
    return PlayBillingNativeClient(
        context = context,
        activityProvider = { PayCraftPlatform.currentActivityOrNull() },
    )
}
