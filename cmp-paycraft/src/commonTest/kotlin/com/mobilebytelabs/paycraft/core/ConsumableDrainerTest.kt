package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore
import com.mobilebytelabs.paycraft.repository.FakePayCraftRepository
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * [ConsumableDrainer] — the transfer of purchased units out of the server balance and into the host.
 *
 * ## What is actually at risk
 *
 * This is a two-write transfer across two systems that cannot share a transaction: the server is
 * debited, then the host records the credit. Both failure orders lose real money in one direction
 * or the other, so the tests below are written as the two things that must NEVER happen —
 *
 *  - **Never credit twice.** A crash, a redelivery, or a second `drain()` must not hand out a pack
 *    the customer paid for once. Pinned by replaying the exact same persisted intent and asserting
 *    a single sink call.
 *  - **Never lose a credit.** If the server is debited and the host then fails to record it, the
 *    units must stay pending so the next drain retries — dropping them means the customer paid and
 *    got nothing, and nobody finds out but them.
 *
 * — plus the invariant that makes both survivable: the intent is persisted BEFORE the server is
 * touched, which is what the resume test exercises by starting from a store that already holds one.
 *
 * `assertEquals(1, …)` on a recorded call list rather than "it worked": a drainer that credits
 * twice passes every balance assertion you can write, because the balance ends up at the same
 * place. Only the call count distinguishes correct from double-spending.
 */
class ConsumableDrainerTest {

    private companion object {
        const val SKU = "cappy_ripples_550"
        const val GRANT_ID = "grant-1"
    }

    private fun consumable(sku: String) = BillingPlan(
        id = sku,
        name = sku,
        price = "$4.99",
        interval = "lifetime",
        rank = 0,
        isConsumable = true,
        grantQuantity = 550,
    )

    /** Records every credit so a double-credit is visible as a count, not inferred from a balance. */
    private class RecordingSink(private val commits: Boolean = true) : ConsumableGrantSink {
        val credits = mutableListOf<Triple<String, Int, String>>()
        override suspend fun credit(sku: String, quantity: Int, grantId: String): Boolean {
            credits += Triple(sku, quantity, grantId)
            return commits
        }
    }

    private fun drainer(
        repository: FakePayCraftRepository,
        store: PayCraftSettingsStore,
        sink: ConsumableGrantSink,
        grantId: String = GRANT_ID,
    ) = ConsumableDrainer(repository, store, sink, newGrantId = { grantId })

    @Test
    fun a_server_balance_reaches_the_host_once_and_leaves_nothing_pending() = runTest {
        val repository = FakePayCraftRepository().apply {
            setPlans(listOf(consumable(SKU)))
            setBalance(SKU, 550)
        }
        val store = PayCraftSettingsStore(MapSettings())
        val sink = RecordingSink()

        val credited = drainer(repository, store, sink).drain()

        assertEquals(550, credited)
        assertEquals(listOf(Triple(SKU, 550, GRANT_ID)), sink.credits)
        // Debited server-side, not decremented locally — the balance the host saw is gone from the
        // server too, so a second drain has nothing to find.
        assertEquals(0, repository.refreshBalance(SKU))
        assertNull(store.getConsumablePending(), "a settled grant must not stay pending")
    }

    @Test
    fun a_zero_balance_costs_one_read_and_touches_nothing() = runTest {
        val repository = FakePayCraftRepository().apply { setPlans(listOf(consumable(SKU))) }
        val store = PayCraftSettingsStore(MapSettings())
        val sink = RecordingSink()

        assertEquals(0, drainer(repository, store, sink).drain())

        assertTrue(sink.credits.isEmpty())
        assertTrue(repository.spendCalls.isEmpty(), "nothing to drain must not call spend")
        assertNull(store.getConsumablePending())
    }

    @Test
    fun a_subscription_is_never_drained() = runTest {
        // The balance is keyed by sku, so a subscription with a stray balance row would be drained
        // by a drainer that filtered on anything but isConsumable — handing out units for a
        // recurring plan that never granted any.
        val monthly = BillingPlan(id = "monthly", name = "Monthly", price = "$4.99", interval = "month", rank = 0)
        val repository = FakePayCraftRepository().apply {
            setPlans(listOf(monthly))
            setBalance("monthly", 999)
        }
        val store = PayCraftSettingsStore(MapSettings())
        val sink = RecordingSink()

        assertEquals(0, drainer(repository, store, sink).drain())
        assertTrue(sink.credits.isEmpty())
    }

    @Test
    fun a_crash_after_the_debit_is_resumed_without_crediting_twice() = runTest {
        // The state a crash leaves: intent persisted, server already debited (the spend went
        // through, the process died before the host wrote). The resume must replay under the SAME
        // key and credit exactly once.
        val repository = FakePayCraftRepository().apply {
            setPlans(listOf(consumable(SKU)))
            setBalance(SKU, 550)
        }
        val store = PayCraftSettingsStore(MapSettings())
        store.saveConsumablePending(GRANT_ID, SKU, 550)
        // Pre-debit under the same key, exactly as the lost run did.
        repository.spend(SKU, 550, GRANT_ID)
        val sink = RecordingSink()

        val credited = drainer(repository, store, sink).drain()

        assertEquals(550, credited)
        assertEquals(1, sink.credits.size, "the replayed grant must credit exactly once")
        assertEquals(GRANT_ID, sink.credits.single().third)
        // One spend call total: the replay was absorbed by the idempotency key rather than debiting
        // a second time. Two calls here would mean a customer charged once and debited twice.
        assertEquals(1, repository.spendCalls.size)
        assertNull(store.getConsumablePending())
    }

    @Test
    fun a_host_that_cannot_commit_keeps_the_grant_pending() = runTest {
        // The server is already debited at this point, so dropping the grant would destroy units the
        // customer paid for. It has to survive as an intent for the next drain.
        val repository = FakePayCraftRepository().apply {
            setPlans(listOf(consumable(SKU)))
            setBalance(SKU, 550)
        }
        val store = PayCraftSettingsStore(MapSettings())
        val refusing = RecordingSink(commits = false)

        assertEquals(0, drainer(repository, store, refusing).drain())

        val pending = assertNotNull(store.getConsumablePending(), "a refused credit must stay pending")
        assertEquals(GRANT_ID, pending.grantId)
        assertEquals(SKU, pending.sku)
        assertEquals(550, pending.quantity)

        // Next launch, host now healthy: the same grant lands, once, under the same key.
        val healthy = RecordingSink()
        assertEquals(550, drainer(repository, store, healthy).drain())
        assertEquals(1, healthy.credits.size)
        assertEquals(GRANT_ID, healthy.credits.single().third)
        assertNull(store.getConsumablePending())
    }

    @Test
    fun an_offline_spend_credits_nothing_and_stays_pending() = runTest {
        // spend fails BEFORE the host is told anything. The dangerous mistake is crediting anyway —
        // free units for anyone who can drop a connection at the right moment.
        val repository = FakePayCraftRepository().apply {
            setPlans(listOf(consumable(SKU)))
            setBalance(SKU, 100) // less than the 550 the drainer will try to take
        }
        val store = PayCraftSettingsStore(MapSettings())
        val sink = RecordingSink()

        // Pending intent for more than the balance holds: spend must fail.
        store.saveConsumablePending(GRANT_ID, SKU, 550)

        // A DIFFERENT id for the fresh lane, so the assertion cannot be satisfied by the fake
        // replaying the failed attempt's key — which is how this test first passed against a
        // drainer that went on to overwrite the pending intent.
        assertEquals(0, drainer(repository, store, sink, grantId = "grant-2").drain())
        assertTrue(sink.credits.isEmpty(), "a failed spend must never credit the host")
        val kept = assertNotNull(store.getConsumablePending(), "a failed spend must keep the intent for retry")
        assertEquals(GRANT_ID, kept.grantId, "the unsettled intent must survive, not be replaced")
        assertEquals(550, kept.quantity)
    }
}
