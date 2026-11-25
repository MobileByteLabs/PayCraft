package com.mobilebytelabs.paycraft.billing

import com.android.billingclient.api.BillingClient.BillingResponseCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A Play product lookup that did not return the product says WHY (2026-11-25): 40 Reels Downloader buyers in a week
 * were reported `product_not_found` while Play listed every product ACTIVE in 174 regions — the lookup's own error
 * (service down, network, billing unavailable on the device) was thrown away and reported as a missing product.
 * `product_not_found` is now only Play answering OK with no such product.
 */
class PlayProductLookupFailureTest {

    @Test fun found_product_is_no_failure() {
        assertNull(productLookupFailure("pro_quarterly", BillingResponseCode.OK, "", found = true))
    }

    @Test fun ok_without_the_product_is_product_not_found() {
        assertEquals("product_not_found", productLookupFailure("pro_quarterly", BillingResponseCode.OK, "", found = false)?.code)
    }

    @Test fun a_failed_lookup_reports_plays_response_code_not_a_missing_product() {
        val f = productLookupFailure("pro_quarterly", BillingResponseCode.SERVICE_UNAVAILABLE, "Service unavailable", found = false)
        assertEquals("query_${BillingResponseCode.SERVICE_UNAVAILABLE}", f?.code)
        assertEquals("Play product lookup failed for pro_quarterly: Service unavailable", f?.message)
        assertEquals("query_${BillingResponseCode.BILLING_UNAVAILABLE}", productLookupFailure("p", BillingResponseCode.BILLING_UNAVAILABLE, "", found = false)?.code)
        assertEquals("query_${BillingResponseCode.NETWORK_ERROR}", productLookupFailure("p", BillingResponseCode.NETWORK_ERROR, "", found = false)?.code)
    }
}
