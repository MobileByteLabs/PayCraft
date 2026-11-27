package com.mobilebytelabs.paycraft

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** PayCraft Cloud is reached through the edge proxy only — an app that addresses supabase.co bypasses Cloudflare. */
class CloudEndpointTest {

    @Test
    fun cloudGoesThroughTheEdgeProxy() {
        assertEquals("https://edge.paycraft.mobilebytesensei.com", PayCraftBackend.Cloud.supabaseUrl)
        assertEquals("https://edge.paycraft.mobilebytesensei.com/functions/v1/config", PayCraftBackend.Cloud.configUrl)
        assertFalse(PayCraftBackend.Cloud.supabaseUrl.contains("supabase.co"))
    }
}
