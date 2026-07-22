package com.mobilebytelabs.paycraft.fee.canary.green

import com.mobilebytelabs.paycraft.fee.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FeeRouterCanaryTest {
    // Commission values are CONFIG (injected here as a fixture) — never hardcoded in production source.
    private val table = StoreTaxTable(mapOf(
        (Jurisdiction.US to BillingLane.US_EXTERNAL_LINK) to 0.0,       // $0 store tax where legal (D3)
        (Jurisdiction.US to BillingLane.NATIVE_IAP) to 0.27,           // link-out alt vs native cut
        (Jurisdiction.EU to BillingLane.EU_DMA_CTC) to 0.05,           // EU 5% CTC
        (Jurisdiction.GLOBAL to BillingLane.GOOGLE_ALT_BILLING) to 0.10, // ~10% alt-billing floor
    ))
    private val router = FeeRouter(table, PspRate(0.019))              // ~1.9% PSP floor

    @Test fun picks_cheapest_legal_lane_and_honest_total() {
        val q = router.route(Jurisdiction.US)
        assertEquals(BillingLane.US_EXTERNAL_LINK, q.lane)             // cheapest legal lane
        assertEquals(0.019, q.total, 1e-9)                            // $0 store tax → total == PSP floor
    }

    @Test fun never_returns_below_psp_floor() {
        val misconfig = StoreTaxTable(mapOf((Jurisdiction.US to BillingLane.PURE_WEB) to -0.5))
        val q = FeeRouter(misconfig, PspRate(0.019)).route(Jurisdiction.US)
        assertTrue(q.total >= 0.019)                                  // clamp holds even on bad config
    }
}
