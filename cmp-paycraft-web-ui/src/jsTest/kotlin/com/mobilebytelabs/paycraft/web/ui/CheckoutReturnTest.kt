package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Coming BACK from the provider. Stripe (success_url) and Razorpay (PayCraft's pay page) both return the buyer to
 * the checkout page with `paycraft_checkout=success|cancel`. Until 2026-11-13 the SDK ignored it, so every site had
 * to invent its own landing — ReelExport forwarded to its pricing page, where a buyer who had just paid saw "Go Pro".
 * The checkout page now owns the return, for every site.
 */
class CheckoutReturnTest {

    private fun opts(json: String): CheckoutPageOptions = js("JSON.parse(json)").unsafeCast<CheckoutPageOptions>()

    @Test
    fun the_return_is_read_from_the_page_url() {
        assertEquals("success", checkoutReturn("https://x.co/checkout/?plan=pro-monthly&paycraft_checkout=success"))
        assertEquals("cancel", checkoutReturn("https://x.co/checkout/?paycraft_checkout=cancel&plan=pro-monthly"))
        assertNull(checkoutReturn("https://x.co/checkout/?plan=pro-monthly"))
        assertNull(checkoutReturn("https://x.co/checkout/?paycraft_checkout=hacked"))
        assertNull(checkoutReturn(null))
    }

    @Test
    fun the_url_is_cleaned_so_a_reload_shows_checkout_again() {
        assertEquals(
            "https://x.co/checkout/?plan=pro-monthly",
            withoutReturn("https://x.co/checkout/?plan=pro-monthly&paycraft_checkout=success"),
        )
    }

    @Test
    fun a_paid_subscription_that_is_active_says_so_and_offers_to_continue(): Promise<*> =
        checkoutView(fakePc(premium = true), "pro-monthly", opts("""{"successUrl":"/studio/","backUrl":"/pricing/"}"""), "success")
            .then { view ->
                val n = assertIs<CheckoutView.Notice>(view).notice
                assertEquals("You're all set", n.title)
                assertTrue("Pro Monthly" in n.body)
                assertEquals("Continue", n.actionLabel)
                assertEquals("/studio/", n.actionHref)
                assertEquals(false, n.pending)
            }

    @Test
    fun a_paid_subscription_the_provider_has_not_confirmed_yet_says_payment_received_and_waits(): Promise<*> =
        checkoutView(fakePc(premium = false), "pro-monthly", opts("""{"successUrl":"/studio/"}"""), "success")
            .then { view ->
                val n = assertIs<CheckoutView.Notice>(view).notice
                assertEquals("Payment received", n.title)
                assertTrue("a minute" in n.body)
                assertEquals(true, n.pending)
            }

    @Test
    fun a_paid_one_time_pack_is_added_without_waiting_for_a_subscription(): Promise<*> =
        checkoutView(fakePc(premium = false), "edits-10", opts("""{"successUrl":"/studio/"}"""), "success")
            .then { view ->
                val n = assertIs<CheckoutView.Notice>(view).notice
                assertEquals("Payment received", n.title)
                assertTrue("10 edits" in n.body && "added" in n.body)
                assertEquals(false, n.pending)
                assertEquals("/studio/", n.actionHref)
            }

    @Test
    fun a_cancelled_return_shows_checkout_again_with_nothing_charged(): Promise<*> =
        checkoutView(fakePc(), "pro-monthly", null, "cancel").then { view ->
            val m = assertIs<CheckoutView.Ready>(view).model
            assertTrue(m.cancelled)
            assertTrue("weren't charged" in checkoutPageHtml(m))
        }

    @Test
    fun without_a_success_url_continue_goes_back(): Promise<*> =
        checkoutView(fakePc(premium = true), "pro-monthly", opts("""{"backUrl":"/pricing/"}"""), "success").then { view ->
            assertEquals("/pricing/", assertIs<CheckoutView.Notice>(view).notice.actionHref)
        }
}
