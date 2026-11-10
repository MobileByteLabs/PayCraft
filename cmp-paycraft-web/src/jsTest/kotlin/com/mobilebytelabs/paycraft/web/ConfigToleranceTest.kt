package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 2.5.2 decoded only what a page uses; 3.0 decodes with the app's model. A malformed paywall block
 * (tenant-written JSONB) must still leave products, prices and checkout working on the website.
 */
class ConfigToleranceTest {
    private val backend = "https://example.supabase.co"

    @Test
    fun aMalformedPaywallStillServesProductsAndCheckout() = runTest {
        val raw = """
            {"products":[{"sku":"pro-monthly","display_name":"Pro","base_price_cents":19900,"base_currency":"INR",
              "store_binding":{"provider":"razorpay","product_id":"plan_inr"}}],
             "providers":[{"provider":"razorpay"}],
             "paywall":{"value_props":[{"unexpected":1}],"theme_jsonb":{"deep":{"x":[1,2]}}}}
        """.trimIndent()
        val net = FakeTransport()
            .on("/functions/v1/config") { raw }
            .on("/functions/v1/checkout-initiate") { """{"url":"https://rzp.io/i/sub_9"}""" }
        val sdk = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
            it.transport = net
            it.store = TokenStore(MemoryKeyValue())
            it.store.saveSignIn("srv_1", "a@x.com")
        }
        val cfg = sdk.loadConfig()
        assertEquals("pro-monthly", cfg.products.single().sku)
        assertEquals(19900, cfg.products.single().amountCents)
        assertEquals("https://rzp.io/i/sub_9", sdk.resolveCheckoutUrl("pro-monthly", null))
    }
}
