package com.mobilebytelabs.paycraft.billing

/**
 * iOS default native client — a real StoreKit 2 client, always.
 *
 * This used to return `null` (later an `UnconfiguredStoreKitClient`) because StoreKit 2 needed a
 * Swift bridge that only the consuming app could supply, so iOS consumers had to copy a Swift file
 * into their Xcode target and load `paycraftStoreKit2BillingModule` by hand. The shim is now
 * SDK-internal (compiled to a static archive and reached via cinterop), so there is nothing to
 * inject and no way to be "unconfigured": `PayCraft.initialize(apiKey)` in commonMain is the whole
 * iOS integration, exactly as it already was on Android.
 */
@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? = StoreKit2NativeBillingClient()
