package com.mobilebytelabs.paycraft.billing

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * The one place an iOS app hands PayCraft its StoreKit 2 bridge.
 *
 * ## Why a registry instead of just working
 *
 * StoreKit 2 (`Product`, `Transaction`, `AppStore`) is pure Swift with `async`/`await` and no
 * Objective-C surface, so Kotlin/Native cannot call it through cinterop the way the Android client
 * calls Play Billing directly. Something Swift-compiled has to exist, and it has to be compiled
 * into the CONSUMING APP's target because that is where the StoreKit entitlement lives.
 *
 * StoreKit 1 (`SKPaymentQueue`) *is* reachable from Kotlin/Native and would need no Swift at all —
 * but it is broadly deprecated as of the iOS 26 SDK (`SKPaymentTransactionStateDeferred` and
 * friends now carry explicit "use Product.purchase" deprecations), so building a new SDK's default
 * on it would be shipping a dead end.
 *
 * So the shim stays, and this registry makes wiring it a single line instead of a Koin module plus
 * a hand-edited import.
 *
 * ## Wiring (one line, at app start)
 *
 * ```swift
 * // AppDelegate / App.init
 * PayCraftStoreKit2.install()
 * ```
 *
 * `install()` constructs the shim and calls [register]. Anything that happens before that — an
 * early paywall, a purchase attempt during launch — fails CLOSED with a message naming this exact
 * line, rather than the previous silent "App Store billing is not available on this device".
 *
 * Registering is idempotent and last-write-wins, so a test can swap in a fake bridge.
 */
object PayCraftStoreKit {

    private var registered: StoreKit2Bridge? = null

    /**
     * Install the StoreKit 2 bridge. Called by `PayCraftStoreKit2.install()` in the Swift shim, or
     * directly by a host that supplies its own [StoreKit2Bridge] implementation (tests, or an app
     * that wants to intercept purchases).
     */
    fun register(bridge: StoreKit2Bridge) {
        registered = bridge
    }

    /** True once a bridge is installed — useful in a host's own diagnostics/health screen. */
    val isConfigured: Boolean get() = registered != null

    internal fun current(): StoreKit2Bridge? = registered

    /** Test seam — drops any registered bridge. */
    internal fun reset() {
        registered = null
    }
}

/**
 * The client returned on iOS before [PayCraftStoreKit.register] has run.
 *
 * Every operation is a CORRECT no-op or an explicit failure — never a web-checkout fallback, which
 * on a native store is the App Store Guideline 3.1.1 violation the checkout-lane router exists to
 * prevent. The difference from the old `null` return is purely diagnostic: the developer now gets a
 * message that names the missing line instead of a generic "billing is not available", which read
 * like a device problem and sent people looking in the wrong place.
 */
internal class UnconfiguredStoreKitClient : NativeBillingClient {

    override val purchaseUpdates: Flow<NativePurchase> = emptyFlow()

    override suspend fun purchase(
        productId: String,
        appUserId: String?,
        productType: NativeProductType,
    ): NativePurchaseResult = NativePurchaseResult.Failed(SETUP_MESSAGE)

    // intentional-noop: no bridge → no store session to query, sync, restore or finish against.
    override suspend fun finishPurchase(purchase: NativePurchase) = Unit
    override suspend fun queryPurchases(): List<NativePurchase> = emptyList()
    override suspend fun sync() = Unit
    override suspend fun restore(): List<NativePurchase> = emptyList()
    override suspend fun manageSubscription(productId: String?) = Unit
    // Returns null DELIBERATELY, and must keep doing so.
    //
    // It is tempting to hand back a locale-derived country here so the caller "gets something".
    // That would be worse than nothing: CountryDetector tags whatever this returns as
    // AUTHORITATIVE_STORE — its strongest provenance — so a device language setting would be
    // recorded as an Apple payment-account storefront. Every downstream trust decision, including
    // the D11 shadow-price divergence log, would then be reasoning from a fabricated signal.
    //
    // Null is also not a dead end: CurrencyResolver.resolveCountry falls through to
    // PlatformInfo.country (the device/SIM region, a genuinely better signal than locale) and only
    // then to the config locale. The unwired case degrades correctly on its own.
    override suspend fun storefrontCountry(): String? = null
    override suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice? =
        null

    private companion object {
        const val SETUP_MESSAGE =
            "PayCraft: StoreKit is not installed. Add `PayCraftStoreKit2.install()` at app start " +
                "(see PayCraftStoreKit2.swift, shipped with the SDK). Until then in-app purchases " +
                "cannot run on iOS."
    }
}
