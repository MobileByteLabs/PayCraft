package com.mobilebytelabs.paycraft.analytics

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Attempt data must be complete (paycraft-attempt-observability D14, AC-10): a batch the ingest did not take is
 * kept on the device and retried with exponential backoff (1 s, 2 s, 4 s … capped at 5 min), survives an app
 * restart, never grows past 500 events (the newest are kept), and a batch the server refuses as malformed is
 * not retried forever — only the event it named is dropped.
 */
class EventRetryQueueTest {
    private val settings = MapSettings()
    private var nowMs = 0L
    private val attempts = mutableListOf<List<PayCraftEvent>>()

    private fun newAnalytics(fail: Boolean = false) = PayCraftAnalytics(
        send = { b ->
            attempts += b
            if (fail) error("transport")
        },
        maxQueue = 500,
        settings = settings,
        now = { nowMs },
    )

    private fun ev(i: Int, name: PayCraftEventName = PayCraftEventName.PaywallView) = PayCraftEvent(
        name = name,
        step = PayCraftStep.Paywall,
        platform = "android",
        sku = "pro-monthly",
        atMs = i.toLong(),
        attemptId = "1700000000000-${i.toString(16)}",
        failure = if (i % 2 ==
            1
        ) {
            PayCraftFailure(PayCraftFailureStage.Provider, "store_purchase", "purchase_$i")
        } else {
            null
        },
    )

    @Test fun failed_batch_is_retried_with_exponential_backoff() = runTest {
        val a = newAnalytics(fail = true)
        a.emit(ev(1))
        a.flush()
        assertEquals(1, attempts.size)
        nowMs = 1_001L
        a.flush()
        assertEquals(2, attempts.size)
        nowMs = 1_500L
        a.flush()
        assertEquals(2, attempts.size) // still in the 2 s backoff window
        nowMs = 3_002L
        a.flush()
        assertEquals(3, attempts.size) // 1 s → 2 s
    }

    @Test fun the_backoff_is_capped_at_five_minutes() {
        assertEquals(1_000L, PayCraftAnalytics.backoffMs(1))
        assertEquals(2_000L, PayCraftAnalytics.backoffMs(2))
        assertEquals(256_000L, PayCraftAnalytics.backoffMs(9))
        assertEquals(300_000L, PayCraftAnalytics.backoffMs(10))
        assertEquals(300_000L, PayCraftAnalytics.backoffMs(40))
    }

    @Test fun queue_survives_restart_via_settings() = runTest {
        newAnalytics(fail = true).apply {
            emit(ev(1))
            flush()
        }
        val revived = newAnalytics() // a new process: same settings, nothing in memory
        nowMs = 10_000L
        revived.flush()
        val resent = attempts.last()
        assertEquals(1, resent.size)
        // The event comes back whole — its attempt and failure are what the timeline needs.
        assertEquals("1700000000000-1", resent.single().attemptId)
        assertEquals("purchase_1", resent.single().code)
        assertEquals("provider", resent.single().stage)
        assertTrue(PayCraftAnalytics.readQueue(settings).isEmpty(), "a delivered batch leaves the queue")
    }

    @Test fun cap_500_drops_oldest_not_newest() = runTest {
        val a = newAnalytics(fail = true)
        repeat(600) { a.emit(ev(it)) }
        a.flush()
        val queued = PayCraftAnalytics.readQueue(settings)
        assertEquals(500, queued.size)
        assertEquals(599, queued.last().atMs.toInt()) // newest kept
        assertEquals(100, queued.first().atMs.toInt())
    }

    @Test fun a_refused_event_is_dropped_and_the_rest_of_its_batch_still_goes() = runTest {
        var refuseOnce = true
        val sent = mutableListOf<PayCraftEvent>()
        val a = PayCraftAnalytics(
            send = { b ->
                if (refuseOnce && b.any { it.name == PayCraftEventName.NudgeOpen }) {
                    refuseOnce = false
                    throw PayCraftAnalytics.Rejected(unknownEventName = PayCraftEventName.NudgeOpen.wire)
                }
                sent += b
            },
            settings = settings,
            now = { nowMs },
        )
        a.emit(ev(2))
        a.emit(ev(4, PayCraftEventName.NudgeOpen))
        a.emit(ev(6))
        a.flush()
        assertEquals(listOf(2L, 6L), sent.map { it.atMs })
        assertTrue(PayCraftAnalytics.readQueue(settings).isEmpty())
    }

    @Test fun a_batch_refused_outright_is_dropped_not_retried_forever() = runTest {
        var calls = 0
        val a = PayCraftAnalytics(
            send = {
                calls++
                throw PayCraftAnalytics.Rejected(unknownEventName = null)
            },
            settings = settings,
            now = { nowMs },
        )
        a.emit(ev(2))
        a.flush()
        nowMs = 600_000L
        a.flush()
        assertEquals(1, calls)
        assertTrue(PayCraftAnalytics.readQueue(settings).isEmpty())
    }

    @Test fun events_older_than_the_ingest_window_are_not_resent() = runTest {
        newAnalytics(fail = true).apply {
            emit(ev(2))
            flush()
        }
        nowMs = 8L * 24 * 3_600_000 // the server refuses events more than 7 days off its clock
        val revived = newAnalytics()
        revived.flush()
        assertEquals(1, attempts.size, "only the first, failed send — the stale event was dropped")
        assertTrue(PayCraftAnalytics.readQueue(settings).isEmpty())
    }
}
