package com.mobilebytelabs.paycraft.billing

/**
 * iOS default native client.
 *
 * Resolves the StoreKit 2 bridge installed via [PayCraftStoreKit.register] (one line at app start:
 * `PayCraftStoreKit2.install()`). StoreKit 2 is Swift-only with no Objective-C surface, so unlike
 * Android — where [platformDefaultNativeBillingClient] builds a real Play client straight from the
 * captured Application context — iOS needs that Swift shim compiled into the app target, where the
 * StoreKit entitlement lives.
 *
 * Never returns null. Before the bridge is installed this hands back
 * [UnconfiguredStoreKitClient], which fails CLOSED with a message naming the missing line. The old
 * null return collapsed into a generic "App Store billing is not available on this device", which
 * reads like a device fault and sends integrators looking in entirely the wrong place.
 */
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? {
    val bridge = PayCraftStoreKit.current() ?: return UnconfiguredStoreKitClient()
    return StoreKit2NativeBillingClient(bridge)
}
