package com.mobilebytelabs.paycraft.analytics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The purchase-attempt spine (paycraft-attempt-observability GOAL D4, AC-9): an id is minted when a plan is picked,
 * held while the buyer pays for it, closed as abandoned when they switch plans, and cleared once premium arrives.
 */
class AttemptTrackerTest {
    private val events = mutableListOf<PayCraftEvent>()
    private var minted = 0
    private val tracker = AttemptTracker(now = { 7L }, newId = { "att-${minted++}" }, platform = { "android" }) {
        events += it
    }

    @Test fun start_mints_an_id_held_on_current() {
        tracker.start(sku = "pro-monthly")
        assertEquals("att-0", tracker.current)
        assertEquals("pro-monthly", tracker.currentSku)
        assertTrue(events.isEmpty(), "the first attempt closes nothing")
    }

    @Test fun new_plan_select_closes_previous_as_abandoned() {
        tracker.start("pro-monthly")
        val first = tracker.current
        tracker.start("pro-annual")
        val closed = events.single { it.attemptId == first && it.failure?.errorClass == "flow_switch" }
        assertEquals(PayCraftEventName.AttemptAbandon, closed.name)
        assertEquals("new_plan_select", closed.failure!!.code)
        assertEquals("sdk", closed.stage)
        assertEquals("pro-monthly", closed.sku, "the abandoned attempt's own plan")
        assertEquals(7L, closed.atMs)
        assertNotEquals(first, tracker.current)
    }

    @Test fun close_granted_clears_current() {
        tracker.start("pro-monthly")
        tracker.granted()
        assertNull(tracker.current)
        assertNull(tracker.currentSku)
    }

    @Test fun a_retry_of_the_same_plan_joins_the_open_attempt() {
        tracker.start("pro-monthly")
        val id = tracker.current
        // The store sheet was closed, or the payment failed: the attempt stays open for the retry.
        assertEquals(id, tracker.ensure("pro-monthly"))
        assertEquals(id, tracker.ensure("pro-monthly"))
        assertTrue(events.isEmpty())
    }

    @Test fun ensure_opens_an_attempt_when_checkout_starts_without_a_plan_pick() {
        assertEquals("att-0", tracker.ensure("pro-monthly"))
        assertEquals("att-0", tracker.ensure(null), "a lane that does not know the plan joins the open attempt")
        assertEquals("att-1", tracker.ensure("pro-annual"), "a different plan is a new attempt")
        assertEquals(1, events.count { it.name == PayCraftEventName.AttemptAbandon })
    }

    @Test fun the_app_minted_id_is_one_the_server_accepts() {
        val id = mintAttemptId(1_764_000_000_000L)
        assertTrue(Regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$").matches(id), id)
        assertTrue(id.length <= 64, "fits Play's obfuscatedProfileId (64 chars): $id")
        assertTrue(id.startsWith("1764000000000-"), id)
        assertNotEquals(mintAttemptId(1L), mintAttemptId(1L), "random, not derived")
    }
}
