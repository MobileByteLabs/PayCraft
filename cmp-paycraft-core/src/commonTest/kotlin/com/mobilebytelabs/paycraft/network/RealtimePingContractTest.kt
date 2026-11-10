package com.mobilebytelabs.paycraft.network

import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * RT-3 / RT-6 — the ping→refetch contract.
 *
 * `PayCraftRealtime` itself needs a live Supabase socket, so it cannot be unit-tested here. What
 * CAN be pinned — and what actually regressed — is the *handler* the SDK installs on a ping:
 *
 *  - `refreshConfig()` cancelled the in-flight fetch before starting a new one; the realtime ping
 *    handler did not. A burst of dashboard saves therefore left parallel fetches racing to publish
 *    onto the same StateFlow, so the paywall could settle on the loser's stale payload.
 *  - Nothing debounced the burst, so N saves meant N full config round-trips.
 *
 * These model that handler exactly (cancel-then-debounce-then-fetch) and assert both properties,
 * using the virtual clock so the debounce is deterministic rather than timing-dependent.
 */
class RealtimePingContractTest {

    private val debounceMs = 400L

    /**
     * The handler shape installed by `PayCraft.startRealtime`: cancel any in-flight job, then
     * launch a debounced fetch.
     */
    private class PingHandler(
        private val scope: kotlinx.coroutines.CoroutineScope,
        private val debounceMs: Long,
        private val fetch: suspend () -> Unit,
    ) {
        private var job: Job? = null
        fun onPing() {
            job?.cancel()
            job = scope.launch {
                delay(debounceMs)
                fetch()
            }
        }
    }

    @Test
    fun burstOfPings_collapsesIntoASingleFetch() = runTest {
        var fetches = 0
        val handler = PingHandler(this, debounceMs) { fetches++ }

        // Six products saved in the dashboard in quick succession → six broadcast pings.
        repeat(6) { handler.onPing() }
        runCurrent()
        assertEquals(0, fetches, "Nothing should fire until the burst settles.")

        delay(debounceMs + 50)

        assertEquals(
            1,
            fetches,
            "A burst of dashboard saves must collapse into ONE refetch. Before the debounce each " +
                "ping launched its own fetch and they raced to publish onto the same StateFlow.",
        )
    }

    @Test
    fun laterPingCancelsTheEarlierFetch_soTheNewestPayloadWins() = runTest {
        val started = mutableListOf<Int>()
        val completed = mutableListOf<Int>()
        var seq = 0
        val handler = PingHandler(this, debounceMs) {
            val id = ++seq
            started += id
            delay(1_000) // a slow config round-trip
            completed += id
        }

        handler.onPing()
        delay(debounceMs + 50) // first fetch is now in flight
        assertEquals(listOf(1), started)

        handler.onPing() // a second save lands mid-flight
        delay(debounceMs + 50)
        delay(1_500) // let everything that can finish, finish

        assertTrue(
            1 !in completed,
            "The superseded fetch must be CANCELLED, not left to finish and publish stale config " +
                "after the newer one. refreshConfig() always cancelled first; the ping path did not.",
        )
        assertEquals(
            listOf(2),
            completed,
            "Exactly the newest fetch completes, so the freshest payload is what reaches the flow.",
        )
    }

    @Test
    fun aSinglePingStillFetches() = runTest {
        var fetches = 0
        val handler = PingHandler(this, debounceMs) { fetches++ }

        handler.onPing()
        delay(debounceMs + 50)

        assertEquals(
            1,
            fetches,
            "Debouncing must not swallow the ordinary single-edit case — that is the whole point " +
                "of realtime: a dashboard change reaches the app without waiting for the TTL.",
        )
    }

    @Test
    fun pingsSpacedBeyondTheDebounce_eachFetch() = runTest {
        var fetches = 0
        val handler = PingHandler(this, debounceMs) { fetches++ }

        handler.onPing()
        delay(debounceMs + 50)
        handler.onPing()
        delay(debounceMs + 50)

        assertEquals(2, fetches, "Genuinely separate edits must each refetch.")
    }
}
