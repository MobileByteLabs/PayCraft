package com.mobilebytelabs.paycraft.analytics

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The emitter's contract with the host app (GOAL AC-3): the app's listener sees every catalog event in order;
 * a missing or broken listener never affects the paywall; consent off means nothing leaves the device; and the
 * ingest queue is bounded and batched, so an offline buyer cannot grow memory or flood the server.
 */
class PayCraftAnalyticsTest {

    private fun ev(name: PayCraftEventName, step: PayCraftStep, at: Long = 0) = PayCraftEvent(
        name,
        step,
        platform = "android",
        trigger = "home",
        sku = "pro-monthly",
        currency = "INR",
        atMs = at,
    )

    @Test fun the_listener_receives_each_event_in_order_with_its_params() = runTest {
        val seen = mutableListOf<Pair<String, Map<String, String>>>()
        val a = PayCraftAnalytics(send = {})
        a.listener = PayCraftAnalyticsListener { n, p -> seen += n to p }
        a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall))
        a.emit(ev(PayCraftEventName.PlanSelect, PayCraftStep.Plan))
        a.emit(ev(PayCraftEventName.StepAbandon, PayCraftStep.Plan))
        assertEquals(
            listOf("paycraft_paywall_view", "paycraft_plan_select", "paycraft_step_abandon"),
            seen.map {
                it.first
            },
        )
        assertEquals("plan", seen[2].second["step"])
        assertEquals("home", seen[0].second["trigger"])
    }

    @Test fun no_listener_and_a_throwing_listener_never_break_emit() = runTest {
        val sent = mutableListOf<PayCraftEvent>()
        val a = PayCraftAnalytics(send = { sent += it })
        a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall))
        a.listener = PayCraftAnalyticsListener { _, _ -> error("host bug") }
        a.emit(ev(PayCraftEventName.PlanSelect, PayCraftStep.Plan))
        a.flush()
        assertEquals(2, sent.size)
    }

    @Test fun consent_off_sends_nothing_to_ingest_but_the_app_still_sees_events() = runTest {
        val sent = mutableListOf<PayCraftEvent>()
        val seen = mutableListOf<String>()
        val a = PayCraftAnalytics(send = { sent += it })
        a.listener = PayCraftAnalyticsListener { n, _ -> seen += n }
        a.ingestEnabled = false
        a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall))
        a.flush()
        assertTrue(sent.isEmpty())
        assertEquals(listOf("paycraft_paywall_view"), seen)
    }

    @Test fun flush_sends_in_batches_of_max_batch() = runTest {
        val batches = mutableListOf<Int>()
        val a = PayCraftAnalytics(send = { batches += it.size }, maxBatch = 20)
        repeat(45) { a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall, at = it.toLong())) }
        a.flush()
        assertEquals(listOf(20, 20, 5), batches)
    }

    @Test fun the_queue_is_bounded_and_keeps_the_newest() = runTest {
        val sent = mutableListOf<PayCraftEvent>()
        val a = PayCraftAnalytics(send = { sent += it }, maxQueue = 200)
        repeat(250) { a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall, at = it.toLong())) }
        a.flush()
        assertEquals(200, sent.size)
        assertEquals(50L, sent.first().atMs)
        assertEquals(249L, sent.last().atMs)
    }

    @Test fun a_failed_send_is_swallowed_and_does_not_retry_forever() = runTest {
        var calls = 0
        val a = PayCraftAnalytics(send = {
            calls++
            error("offline")
        })
        a.emit(ev(PayCraftEventName.PaywallView, PayCraftStep.Paywall))
        a.flush()
        a.flush()
        assertEquals(1, calls)
    }
}
