package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Locks that the SDK trusts the SERVER's per-platform provider ordering (migration 075) instead of
 * making an arbitrary pick. `/config` orders `providers[]` by the tenant's platform routing rules,
 * so [primaryProvider] must return the head in that server order — a "desktop → Stripe" tenant gets
 * Stripe first on desktop, an "android → Razorpay" tenant gets Razorpay first on Android.
 */
class ProviderSelectionTest {

    private fun suite(vararg providers: String) =
        SuiteConfig(tenantId = "t", providers = providers.map { ProviderDto(provider = it) })

    @Test fun primaryFollowsServerOrder_stripeFirst() {
        assertEquals("stripe", suite("stripe", "razorpay").primaryProvider()?.provider)
    }

    @Test fun primaryFollowsServerOrder_razorpayFirst() {
        // Same providers, server-reordered for this platform: the SDK must follow the server order,
        // not fall back to a first-registered / alphabetical pick.
        assertEquals("razorpay", suite("razorpay", "stripe").primaryProvider()?.provider)
    }

    @Test fun primaryNullWhenNoProviders() {
        assertNull(suite().primaryProvider())
    }
}
