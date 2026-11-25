package com.mobilebytelabs.paycraft.billing

import android.content.Context
import android.os.Build
import com.android.billingclient.api.BillingClient.BillingResponseCode

/** Google Play's installer package. */
private const val PLAY_INSTALLER = "com.android.vending"

/**
 * Whether Google Play installed this app; null when the platform will not say. Read through `getInstallSourceInfo`
 * (Android 11+); older releases answer null — the lookup then keeps reporting `product_not_found`, never a guess.
 */
internal fun installedFromPlay(context: Context): Boolean? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    return runCatching {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName == PLAY_INSTALLER
    }.getOrNull()
}

/**
 * Why a Play product lookup gave no product, as the attempt's failure — or null when the product came back.
 *
 * Play answering OK without the product is `product_not_found` (a catalogue problem the merchant can fix). Any other
 * answer is the lookup itself failing — Play services down, no network, billing unavailable on the device — and is
 * reported as `query_<responseCode>`. Before 2026-11-25 both read `product_not_found`, which sent merchants hunting
 * through a catalogue Play reported as ACTIVE everywhere.
 */
internal fun productLookupFailure(
    productId: String,
    responseCode: Int,
    debugMessage: String?,
    found: Boolean,
    fromPlay: Boolean? = null,
): NativePurchaseResult.Failed? = when {
    found -> null
    // Play sells only to apps it installed: an APK from anywhere else gets OK with no product. That is not a
    // catalogue problem, so it gets its own code (paycraft-ga4-analytics-audit AC-3). Unknown installer → unchanged.
    responseCode == BillingResponseCode.OK && fromPlay == false ->
        NativePurchaseResult.Failed("App not installed from Google Play — Play cannot sell $productId to it", "not_from_play")
    responseCode == BillingResponseCode.OK ->
        NativePurchaseResult.Failed("Product not found on Play: $productId", "product_not_found")
    else -> NativePurchaseResult.Failed(
        "Play product lookup failed for $productId: ${debugMessage.orEmpty()}",
        "query_$responseCode",
    )
}
