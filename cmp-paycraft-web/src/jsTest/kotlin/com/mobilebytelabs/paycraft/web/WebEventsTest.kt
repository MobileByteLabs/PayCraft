package com.mobilebytelabs.paycraft.web

import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The web SDK's paywall events (paycraft-paywall-analytics AC-4): the site's `onEvent` listener sees each event
 * as a plain object it can hand straight to gtag, and the same events are sent to PayCraft's `events` ingest
 * in the agreed body — or, when the buyer leaves the page, by beacon, which carries no headers.
 */
class WebEventsTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(net: FakeTransport): PayCraftWeb = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(MemoryKeyValue())
        it.now = { 1_000_000.0 }
        it.newDeviceId = { "dev-web-1" }
    }

    @Test fun the_listener_gets_each_event_with_gtag_ready_params() {
        val pc = sdk(FakeTransport())
        val seen = mutableListOf<Pair<String, dynamic>>()
        pc.onEvent { name, params -> seen += name to params }
        pc.setCountry("IN")
        pc.track(PayCraftEventName.ProviderView, PayCraftStep.Provider, sku = "pro-monthly", currency = "INR")
        pc.track(
            PayCraftEventName.ProviderSelect,
            PayCraftStep.Provider,
            sku = "pro-monthly",
            currency = "INR",
            provider = "stripe",
        )
        pc.track(
            PayCraftEventName.CheckoutStart,
            PayCraftStep.Checkout,
            sku = "pro-monthly",
            currency = "INR",
            provider = "stripe",
        )
        assertEquals(
            listOf("paycraft_provider_view", "paycraft_provider_select", "paycraft_checkout_start"),
            seen.map {
                it.first
            },
        )
        val p = seen[2].second
        assertEquals("checkout", p.step as String)
        assertEquals("web", p.platform as String)
        assertEquals("stripe", p.provider as String)
        assertEquals("IN", p.country as String)
    }

    @Test fun a_throwing_listener_never_breaks_tracking() {
        val pc = sdk(FakeTransport())
        pc.onEvent { _, _ -> error("site bug") }
        pc.track(PayCraftEventName.ProviderView, PayCraftStep.Provider)
        assertEquals(1, pc.pendingEventCount())
    }

    @Test fun flush_posts_the_batch_to_the_events_ingest() = runTest {
        val net = FakeTransport().on("/functions/v1/events") { """{"stored":2}""" }
        val pc = sdk(net)
        pc.track(PayCraftEventName.ProviderView, PayCraftStep.Provider, sku = "pro-monthly", currency = "INR")
        pc.track(PayCraftEventName.StepAbandon, PayCraftStep.Provider, sku = "pro-monthly", currency = "INR")
        pc.flushEvents()
        val call = net.calls.single()
        assertEquals("POST", call.method)
        assertTrue(call.url.endsWith("/functions/v1/events?apiKey=pk_test_abc"))
        val body = Json.parseToJsonElement(call.body!!).jsonObject
        assertEquals("dev-web-1", body["deviceRef"]!!.jsonPrimitive.content)
        assertEquals("test", body["mode"]!!.jsonPrimitive.content)
        val events = body["events"]!!.jsonArray
        assertEquals(
            listOf("paycraft_provider_view", "paycraft_step_abandon"),
            events.map {
                it.jsonObject["name"]!!.jsonPrimitive.content
            },
        )
        assertNull(events[0].jsonObject["country"], "the server stamps the country")
        assertEquals(0, pc.pendingEventCount())
    }

    @Test fun leaving_the_page_sends_what_is_queued_by_beacon_with_the_mode_in_the_body() {
        val pc = sdk(FakeTransport())
        val beacons = mutableListOf<Pair<String, String>>()
        pc.beacon = { url, body ->
            beacons += url to body
            true
        }
        pc.track(PayCraftEventName.StepAbandon, PayCraftStep.Provider, sku = "pro-monthly")
        pc.flushEventsOnLeave()
        val (url, body) = beacons.single()
        assertTrue(url.contains("/functions/v1/events?apiKey="))
        assertEquals("test", Json.parseToJsonElement(body).jsonObject["mode"]!!.jsonPrimitive.content)
        assertEquals(0, pc.pendingEventCount())
    }

    @Test fun the_queue_is_bounded() {
        val pc = sdk(FakeTransport())
        repeat(80) { pc.track(PayCraftEventName.ProviderView, PayCraftStep.Provider) }
        assertEquals(50, pc.pendingEventCount())
    }
}
