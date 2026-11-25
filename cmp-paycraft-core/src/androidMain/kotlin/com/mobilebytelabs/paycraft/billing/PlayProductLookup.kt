package com.mobilebytelabs.paycraft.billing

import com.android.billingclient.api.BillingClient.BillingResponseCode

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
): NativePurchaseResult.Failed? = when {
    found -> null
    responseCode == BillingResponseCode.OK ->
        NativePurchaseResult.Failed("Product not found on Play: $productId", "product_not_found")
    else -> NativePurchaseResult.Failed(
        "Play product lookup failed for $productId: ${debugMessage.orEmpty()}",
        "query_$responseCode",
    )
}
