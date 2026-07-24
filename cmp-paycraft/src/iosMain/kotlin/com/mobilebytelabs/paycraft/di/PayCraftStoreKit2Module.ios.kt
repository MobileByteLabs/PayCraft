package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.StoreKit2Bridge
import com.mobilebytelabs.paycraft.billing.StoreKit2NativeBillingClient
import org.koin.core.module.Module
import org.koin.dsl.module

/**
 * iOS-side Koin override that swaps the default `WebCheckoutNativeBillingClient`
 * (bound in `PayCraftModule`) for the real StoreKit2 [StoreKit2NativeBillingClient].
 *
 * The consuming iOS app constructs the Swift [StoreKit2Bridge] shim
 * (`iosMain/swift/PayCraftStoreKit2.swift`) and passes it in, AFTER
 * [com.mobilebytelabs.paycraft.di.PayCraftModule]:
 *
 * ```swift
 * // Swift
 * let bridge = PayCraftStoreKit2()          // conforms to StoreKit2Bridge
 * KoinKt.doInitKoin(extra: [PayCraftDIKt.paycraftStoreKit2BillingModule(bridge: bridge)])
 * ```
 *
 * @param bridge the app-provided Swift StoreKit2 shim.
 */
fun paycraftStoreKit2BillingModule(bridge: StoreKit2Bridge): Module = module {
    single<NativeBillingClient> { StoreKit2NativeBillingClient(bridge) }
}
