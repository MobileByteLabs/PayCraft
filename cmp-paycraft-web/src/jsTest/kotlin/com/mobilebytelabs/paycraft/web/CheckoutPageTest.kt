package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The SDK's checkout page (`mountCheckout`): which page a buyer gets, what it lists, and that every value on
 * it is escaped. The DOM half only renders [checkoutPageHtml] and wires two listeners; the decisions are here.
 */
class CheckoutPageTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(net: FakeTransport): PayCraftWeb = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(MemoryKeyValue())
        it.now = { 1_000_000.0 }
        it.newDeviceId = { "dev-1" }
        it.deviceName = { "Chrome on Mac" }
        it.currentPage = { "https://site.example/checkout/?plan=pro-monthly" }
    }

    private fun signedIn(cfg: String) = FakeTransport()
        .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"google"}""" }
        .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
        .on("/rest/v1/rpc/get_active_devices") {
            """[{"device_ref":"me","this_device":true,"device_name":"Chrome on Mac","platform":"web","max_devices":2}]"""
        }
        .on("/functions/v1/config") { cfg }

    private fun opts(js: String): CheckoutPageOptions = js("JSON.parse(js)").unsafeCast<CheckoutPageOptions>()

    @Test
    fun razorpay_lists_upi_netbanking_and_wallets_only_for_rupees() {
        assertEquals(listOf("UPI", "Cards", "Netbanking", "Wallets"), paymentMethods("razorpay", "INR").methods)
        assertEquals(listOf("Cards"), paymentMethods("razorpay", "USD").methods)
        assertEquals("International cards", paymentMethods("razorpay", "usd").summary)
        assertEquals(listOf("Cards", "Apple Pay", "Google Pay"), paymentMethods("stripe", "INR").methods)
        assertTrue(paymentMethods("cashfree", "INR").methods.isEmpty())
    }

    @Test
    fun a_signed_out_buyer_is_sent_to_sign_in_not_shown_a_payment_page() = runTest {
        val view = sdk(
            FakeTransport(),
        ).checkoutView("pro-monthly", opts("""{"signInUrl":"/signin/?plan=pro-monthly","backUrl":"/pricing/"}"""))
        val n = assertIs<CheckoutView.Notice>(view).notice
        assertEquals("Sign in to continue", n.title)
        assertEquals("/signin/?plan=pro-monthly", n.actionHref)
        assertEquals("/pricing/", n.backUrl)
    }

    @Test
    fun the_page_lists_every_provider_that_can_charge_the_price_with_every_method_it_offers() = runTest {
        val pc = sdk(signedIn(TWO_PROVIDER_INR))
        pc.doSignIn("google", "t", null)
        val view = pc.checkoutView("pro-monthly", opts("""{"features":["No ads anywhere"," "],"termsUrl":"/terms/"}"""))
        val m = assertIs<CheckoutView.Ready>(view).model
        assertEquals("Pro Monthly", m.planName)
        assertEquals("month", m.period)
        assertEquals(14, m.trialDays)
        assertEquals("a@x.com", m.email)
        assertEquals(2, m.maxDevices) // read from the device list: this page load never saw a sign-in result with it
        assertEquals(listOf("No ads anywhere"), m.features)
        assertEquals(listOf("razorpay", "stripe"), m.cards.map { it.provider })
        assertTrue(m.cards[0].recommended)
        assertFalse(m.cards[1].recommended)
        assertEquals(listOf("UPI", "Cards", "Netbanking", "Wallets"), m.cards[0].info.methods)

        val html = checkoutPageHtml(m)
        for (method in listOf("UPI", "Netbanking", "Wallets", "Apple Pay", "Google Pay", "RuPay")) {
            assertTrue(method in html, "page lists $method")
        }
        assertTrue("""value="razorpay" checked""" in html) // the recommended provider is pre-selected
        assertTrue("Continue to Razorpay" in html)
        assertTrue("up to 2 devices" in html)
        assertTrue("""href="/terms/"""" in html)
    }

    @Test
    fun an_unknown_plan_shows_a_notice_back_to_the_plans() = runTest {
        val pc = sdk(signedIn(TWO_PROVIDER_INR))
        pc.doSignIn("google", "t", null)
        val n = assertIs<CheckoutView.Notice>(pc.checkoutView("gone", opts("""{"backUrl":"/pricing/"}"""))).notice
        assertEquals("This plan isn't available", n.title)
        assertEquals("/pricing/", n.actionHref)
    }

    @Test
    fun every_value_is_escaped_and_unsafe_links_are_dropped() {
        val m = CheckoutModel(
            planName = "<img src=x onerror=alert(1)>",
            price = "₹299",
            period = null,
            trialDays = null,
            email = "\"a\"@x.com",
            maxDevices = 1,
            features = listOf("<b>bold</b>"),
            cards = listOf(CheckoutMethodCard("stripe", "Stripe", paymentMethods("stripe", "USD"), false)),
            backUrl = "javascript:alert(1)",
            termsUrl = "//evil.example/terms",
            refundUrl = "https://site.example/refund/",
        )
        val html = checkoutPageHtml(m)
        assertFalse("<img" in html)
        assertFalse("<b>bold" in html)
        assertFalse("javascript:" in html)
        assertFalse("evil.example" in html)
        assertTrue("https://site.example/refund/" in html)
        assertTrue("One-time payment" in html)
        assertFalse("devices at a time" in html) // a single seat is not a selling point
        assertNull(safeHref("data:text/html,x"))
        assertEquals("/pricing/", safeHref(" /pricing/ "))
    }

    @Test
    fun prices_are_formatted_as_money_not_as_a_number_and_a_code() {
        val inr = formatMoney(29900, "INR")
        assertTrue("₹" in inr && "299" in inr && "INR" !in inr, inr)
        assertTrue("$" in formatMoney(990, "USD") && "9.90" in formatMoney(990, "USD"))
        assertEquals("1 NOPE", formatMoney(100, "NOPE"))
    }

    @Test
    fun checkout_errors_read_as_sentences() {
        assertTrue(checkoutErrorMessage("network_error").startsWith("Couldn't reach"))
        assertEquals("Checkout failed. Please try again.", checkoutErrorMessage("http_500"))
    }

    private companion object {
        val TWO_PROVIDER_INR = """
            {"tenant_id":"t1","mode":"ad_supported",
             "products":[{"id":"p1","sku":"pro-monthly","type":"subscription","display_name":"Pro Monthly","interval":"month",
               "base_price_cents":999,"base_currency":"USD","trial_enabled":true,"trial_duration_days":14,
               "resolved_price":{"amount_cents":29900,"currency":"INR","source":"manual"},
               "store_binding":{"provider":"razorpay","product_id":"plan_inr"},
               "stripe_price_id_by_currency_test":{"USD":"price_t_usd","INR":"price_t_inr"},
               "razorpay_plan_id_by_currency_test":{"INR":"plan_t_inr"}}],
             "providers":[{"provider":"stripe"},{"provider":"razorpay"}]}
        """.trimIndent()
    }
}
