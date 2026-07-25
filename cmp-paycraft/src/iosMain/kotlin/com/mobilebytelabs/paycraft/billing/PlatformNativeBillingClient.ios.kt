package com.mobilebytelabs.paycraft.billing

/**
 * iOS has no AUTO-wireable native client: StoreKit2 requires the app-supplied
 * Swift bridge (`StoreKit2Bridge`), so iOS consumers opt in explicitly via
 * `paycraftStoreKit2BillingModule(bridge)`. Until then the caller falls back to
 * web checkout.
 */
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? = null
