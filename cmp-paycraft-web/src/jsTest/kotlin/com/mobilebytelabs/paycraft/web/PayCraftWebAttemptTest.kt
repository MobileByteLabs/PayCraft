package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The browser SDK's half of the attempt spine (paycraft-attempt-observability D4 / D6, AC-9 / AC-10): the checkout
 * page's events and the checkout-initiate request carry ONE attempt id, and a checkout request that fails — reported
 * by the page with the error code the call threw — surfaces as a structured `sdk / transport / transport_<status>`
 * failure on that attempt.
 */
class PayCraftWebAttemptTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(net: FakeTransport): PayCraftWeb = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(MemoryKeyValue())
        it.now = { 1_000_000.0 }
        it.newDeviceId = { "dev-1" }
        it.deviceName = { "Chrome on Android" }
        it.currentPage = { null }
        var minted = 0
        it.newAttemptId = { if (minted++ == 0) "att-web" else "att-web-$minted" }
    }

    private fun signedIn() = FakeTransport()
        .on("/functions/v1/identity-token/verify") { """{"email":"a+b@x.com","provider":"google"}""" }
        .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
        .on("/functions/v1/config") { PayCraftWebTest.CONFIG_JSON }
        .on("/functions/v1/events") { """{"stored":1}""" }

    private fun events(net: FakeTransport): List<JsonObject> =
        net.bodyOf("/functions/v1/events")["events"]!!.jsonArray.map { it.jsonObject }

    @Test fun events_and_checkout_carry_same_attempt_id() = runTest {
        val net = signedIn().on("/functions/v1/checkout-initiate") { """{"url":"https://rzp.io/i/abc"}""" }
        val pc = sdk(net)
        pc.doSignIn("google", "t", null)
        pc.checkoutEvent("view", "pro-monthly", "INR", null, null)
        pc.checkoutEvent("start", "pro-monthly", "INR", "razorpay", null)
        pc.resolveCheckoutUrl("pro-monthly", "INR")
        pc.flushEvents()
        val sent = events(net)
        assertEquals(listOf("att-web", "att-web"), sent.map { it["attempt_id"]!!.jsonPrimitive.content })
        assertEquals("att-web", net.bodyOf("/functions/v1/checkout-initiate")["attempt_id"]!!.jsonPrimitive.content)
    }

    @Test fun fetch_failure_surfaces_structured_failure() = runTest {
        val net = signedIn().on("/functions/v1/checkout-initiate", status = 502) { """{"error":"upstream down"}""" }
        val pc = sdk(net)
        pc.doSignIn("google", "t", null)
        val error = assertFailsWith<PayCraftWebError> { pc.resolveCheckoutUrl("pro-monthly", "INR") }
        assertEquals("http_502", error.code)
        // The checkout page reports what the call threw — exactly what cmp-paycraft-web-ui's CheckoutMount does.
        pc.checkoutEvent("fail", "pro-monthly", "INR", "razorpay", error.code)
        pc.flushEvents()
        val fail = events(net).single { it["name"]!!.jsonPrimitive.content == "paycraft_purchase_fail" }
        assertEquals("att-web", fail["attempt_id"]!!.jsonPrimitive.content)
        val failure = fail["failure"]!!.jsonObject
        assertEquals("sdk", failure["stage"]!!.jsonPrimitive.content)
        assertEquals("transport", failure["error_class"]!!.jsonPrimitive.content)
        assertEquals("transport_502", failure["error_code"]!!.jsonPrimitive.content)
        assertEquals("transport_502", fail["reason"]!!.jsonPrimitive.content)
    }

    @Test fun a_failure_only_the_page_saw_is_reported_from_the_page() = runTest {
        val net = signedIn()
        val pc = sdk(net)
        pc.checkoutEvent("start", "pro-monthly", "INR", "stripe", null)
        pc.checkoutEvent("fail", "pro-monthly", "INR", "stripe", "bad_checkout_url")
        pc.flushEvents()
        val fail = events(net).single { it["name"]!!.jsonPrimitive.content == "paycraft_purchase_fail" }
        assertEquals("checkout_page", fail["failure"]!!.jsonObject["error_class"]!!.jsonPrimitive.content)
        assertEquals("bad_checkout_url", fail["failure"]!!.jsonObject["error_code"]!!.jsonPrimitive.content)
        assertEquals("att-web", fail["attempt_id"]!!.jsonPrimitive.content)
    }

    @Test fun a_request_that_never_got_an_answer_is_a_network_transport_failure() = runTest {
        val net = signedIn()
        val pc = sdk(net)
        pc.checkoutEvent("start", "pro-monthly", "INR", "stripe", null)
        pc.checkoutEvent("fail", "pro-monthly", "INR", "stripe", "network_error")
        pc.flushEvents()
        val fail = events(net).single { it["name"]!!.jsonPrimitive.content == "paycraft_purchase_fail" }
        assertEquals("transport", fail["failure"]!!.jsonObject["error_class"]!!.jsonPrimitive.content)
        assertEquals("transport_network_error", fail["failure"]!!.jsonObject["error_code"]!!.jsonPrimitive.content)
    }

    @Test fun events_before_any_checkout_carry_no_attempt() = runTest {
        val net = signedIn()
        val pc = sdk(net)
        pc.surveyShown("provider", "pro-monthly")
        pc.flushEvents()
        assertNull(events(net).single()["attempt_id"])
    }

    @Test fun another_plan_on_the_page_is_another_attempt() = runTest {
        val pc = sdk(signedIn())
        val first = pc.attemptFor("pro-monthly")
        assertEquals(first, pc.attemptFor("pro-monthly"))
        val second = pc.attemptFor("pro-annual")
        assertEquals("att-web", first)
        assertEquals("att-web-2", second)
    }

    @Test fun the_browser_attempt_id_is_one_the_server_accepts() {
        val id = PayCraftWeb("pk_test_abc", null, backend, "anon-key").newAttemptId()
        assertTrue(Regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$").matches(id), id)
        assertTrue(id.length <= 64, id)
    }
}
