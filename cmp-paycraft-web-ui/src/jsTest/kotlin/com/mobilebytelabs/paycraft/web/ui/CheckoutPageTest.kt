package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The SDK's checkout page (`mountCheckout`): which page a buyer gets, what it lists, and that every value on it is
 * escaped. It reads the page's PayCraftWeb only through its exported API, so the fake here is a plain object with
 * the same members — exactly what this module sees at runtime. The DOM half only renders [checkoutPageHtml] and
 * wires listeners; the decisions are here.
 */
class CheckoutPageTest {

    private fun opts(json: String): CheckoutPageOptions = js("JSON.parse(json)").unsafeCast<CheckoutPageOptions>()

    @Test
    fun a_signed_out_buyer_is_sent_to_sign_in_not_shown_a_payment_page(): Promise<*> =
        checkoutView(fakePc(email = null), "pro-monthly", opts("""{"signInUrl":"/signin/?plan=pro-monthly","backUrl":"/pricing/"}"""))
            .then { view ->
                val n = assertIs<CheckoutView.Notice>(view).notice
                assertEquals("Sign in to continue", n.title)
                assertEquals("/signin/?plan=pro-monthly", n.actionHref)
                assertEquals("/pricing/", n.backUrl)
            }

    @Test
    fun the_page_lists_every_provider_that_can_charge_the_price_with_every_method_it_offers(): Promise<*> =
        checkoutView(fakePc(), "pro-monthly", opts("""{"features":["No ads anywhere"," "],"termsUrl":"/terms/"}""")).then { view ->
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
            assertEquals(listOf("UPI", "Cards", "Netbanking", "Wallets"), m.cards[0].methods)
            assertEquals(29900, m.amountCents)

            val html = checkoutPageHtml(m)
            for (method in listOf("UPI", "Netbanking", "Wallets", "Apple Pay", "Google Pay", "RuPay")) {
                assertTrue(method in html, "page lists $method")
            }
            assertTrue("""value="razorpay" checked""" in html) // the recommended provider is pre-selected
            assertTrue("Continue to Razorpay" in html)
            assertTrue("up to 2 devices" in html)
            assertTrue("""href="/terms/"""" in html)
            assertTrue("data-pcx-offer" in html, "the summary has a place for a claimed win-back discount")
        }

    @Test
    fun an_unknown_plan_shows_a_notice_back_to_the_plans(): Promise<*> =
        checkoutView(fakePc(), "gone", opts("""{"backUrl":"/pricing/"}""")).then { view ->
            val n = assertIs<CheckoutView.Notice>(view).notice
            assertEquals("This plan isn't available", n.title)
            assertEquals("/pricing/", n.actionHref)
        }

    @Test
    fun a_config_that_fails_to_load_offers_to_try_again(): Promise<*> =
        checkoutView(fakePc(configFails = true), "pro-monthly", null).then { view ->
            assertEquals("Checkout couldn't load", assertIs<CheckoutView.Notice>(view).notice.title)
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
            cards = listOf(CheckoutMethodCard("stripe", "Stripe", listOf("Cards"), listOf("Visa"), null, "Cards", false)),
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
    fun a_claimed_offer_reads_as_the_price_the_buyer_will_pay() {
        assertEquals(14950, discountedCents(29900, 50))
        assertEquals(1499, discountedCents(1999, 25), "14.9925 rounds to the nearest cent")
        val once = offer(percentOff = 50, duration = "once")
        assertTrue(offerAppliedLabel(once, 29900, "INR").let { "50% off applied" in it && "149.50" in it && "first payment" in it })
        assertEquals("20% off applied for 3 months", offerAppliedLabel(offer(20, "repeating", 3), null, null))
    }

    @Test
    fun checkout_errors_read_as_sentences() {
        assertTrue(checkoutErrorMessage("network_error").startsWith("Couldn't reach"))
        assertEquals("Checkout failed. Please try again.", checkoutErrorMessage("http_500"))
    }
}

internal fun offer(percentOff: Int, duration: String, months: Int? = null): WebOfferView =
    js("({})").unsafeCast<WebOfferView>().also {
        val o = it.asDynamic()
        o.id = "o1"
        o.percentOff = percentOff
        o.duration = duration
        o.durationInMonths = months
        o.expiresAt = "2026-11-12T10:00:00Z"
    }

/** The page's PayCraftWeb as this module sees it: a plain object with the exported members it calls. */
internal fun fakePc(email: String? = "a@x.com", configFails: Boolean = false): PayCraftWebApi {
    val pc: dynamic = js("({})")
    pc.email = { email }
    pc.maxDevices = { 1 }
    pc.isPremium = { false }
    pc.config = {
        if (configFails) Promise.reject(Throwable("offline")).unsafeCast<Promise<Any?>>() else Promise.resolve<Any?>(js("JSON.parse")(CONFIG))
    }
    pc.devices = { Promise.resolve<Any?>(js("JSON.parse")("""[{"maxDevices":2}]""")) }
    pc.paymentOptions = { sku: String, _: String? -> if (sku == "pro-monthly") js("JSON.parse")(OPTIONS) else js("[]") }
    return pc.unsafeCast<PayCraftWebApi>()
}

private const val CONFIG =
    """{"products":[{"sku":"pro-monthly","name":"Pro Monthly","interval":"month","amountCents":29900,"currency":"INR","trialDays":14}]}"""
private const val OPTIONS =
    """[{"provider":"razorpay","name":"Razorpay","methods":"UPI, cards, netbanking & wallets","methodList":["UPI","Cards","Netbanking","Wallets"],"cardBrands":["Visa","Mastercard","RuPay"],"note":"Pay with any UPI app."},
       {"provider":"stripe","name":"Stripe","methods":"Cards, Apple Pay & Google Pay","methodList":["Cards","Apple Pay","Google Pay"],"cardBrands":["Visa","Mastercard","American Express"],"note":null}]"""
