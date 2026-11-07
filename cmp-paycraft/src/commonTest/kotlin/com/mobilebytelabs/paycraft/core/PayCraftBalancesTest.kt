package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore
import com.mobilebytelabs.paycraft.repository.FakePayCraftRepository
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [PayCraftBalances] — the SDK-owned balance mirror and its outbox.
 *
 * ## What is actually at risk
 *
 * This class exists so a host never keeps its own ledger. That makes it the only thing standing
 * between "the server's number" and "the number the user sees", and the failures that matter are
 * the ones where those two silently disagree:
 *
 *  - **Never lose a write.** A spend or earn made offline must reach the server eventually. Dropping
 *    one means the user spent units that come back, or earned units that vanish.
 *  - **Never pay twice.** A replayed write must be absorbed. The outbox key IS the idempotency key
 *    for exactly this reason, and it is generated once at enqueue — never at replay.
 *  - **The server always wins.** The mirror is a cache. Every reconcile adopts the server's number
 *    including downward, because a client that could decide its own balance is minting currency.
 *
 * `assertEquals` on a RECORDED CALL rather than on the balance, wherever the distinction exists: a
 * double-spend and a correct spend can land on the same number, and only the call list separates
 * them.
 */
class PayCraftBalancesTest {

    private companion object {
        const val SKU = "coins"
    }

    private fun consumable(sku: String = SKU) = BillingPlan(
        id = sku,
        name = sku,
        price = "$1.99",
        interval = "lifetime",
        rank = 0,
        isConsumable = true,
        grantQuantity = 300,
    )

    private fun balances(
        repo: FakePayCraftRepository,
        store: PayCraftSettingsStore = PayCraftSettingsStore(MapSettings()),
        key: String = "key-1",
    ) = PayCraftBalances(repo, store, newIdempotencyKey = { key })

    private fun repoWith(balance: Int) = FakePayCraftRepository().apply {
        setPlans(listOf(consumable()))
        setBalance(SKU, balance)
    }

    @Test
    fun reconcile_adopts_the_server_number() = runTest {
        val repo = repoWith(500)
        val b = balances(repo)
        b.reconcile(SKU)
        assertEquals(500, b.balanceOf(SKU))
    }

    @Test
    fun the_server_wins_even_when_it_lowers_the_balance() = runTest {
        // The direction a cache is tempted to ignore. A refund, a correction, or another device's
        // spend all arrive as "the server says less than you think" — and the mirror must take it.
        val repo = repoWith(500)
        val b = balances(repo)
        b.reconcile(SKU)
        assertEquals(500, b.balanceOf(SKU))

        repo.setBalance(SKU, 120)
        b.reconcile(SKU)
        assertEquals(120, b.balanceOf(SKU), "the mirror must never hold above the server")
    }

    @Test
    fun a_spend_applies_immediately_and_clears_its_outbox_row() = runTest {
        val repo = repoWith(500)
        val store = PayCraftSettingsStore(MapSettings())
        val b = balances(repo, store)
        b.reconcile(SKU)

        assertTrue(b.spend(SKU, 200))
        assertEquals(300, b.balanceOf(SKU))
        assertEquals(1, repo.spendCalls.size)
        assertTrue(store.pendingSpends().isEmpty(), "an acknowledged spend must leave no outbox row")
    }

    @Test
    fun a_spend_beyond_the_local_balance_is_refused_without_touching_the_server() = runTest {
        val repo = repoWith(50)
        val b = balances(repo)
        b.reconcile(SKU)

        assertFalse(b.spend(SKU, 200))
        assertEquals(50, b.balanceOf(SKU))
        assertTrue(repo.spendCalls.isEmpty(), "an obviously-unaffordable spend must not hit the wire")
    }

    @Test
    fun an_earn_is_idempotent_on_its_event_id() = runTest {
        // The sync case: the same focus session reported twice must pay once. eventId identifies the
        // ACTIVITY, so this is the property that makes a retried sync safe.
        val repo = repoWith(0)
        val b = balances(repo)

        val first = b.earn(SKU, 25, "focus-session-42")
        val second = b.earn(SKU, 25, "focus-session-42")

        assertEquals(25, first)
        assertEquals(25, second, "a replayed earn must not pay twice")
        assertEquals(1, repo.earnCalls.size)
    }

    @Test
    fun an_earn_is_clamped_by_the_server_cap_without_erroring() = runTest {
        // The server clamps to daily_earn_cap. A host that treated "granted < requested" as a
        // failure would show an error to an honest user who simply reached their ceiling.
        val repo = repoWith(0).apply { dailyEarnCap = 50 }
        val b = balances(repo)

        assertEquals(40, b.earn(SKU, 40, "evt-a"))
        assertEquals(50, b.earn(SKU, 40, "evt-b"), "clamped to the cap, not rejected")
        assertEquals(50, b.earn(SKU, 40, "evt-c"), "already at the ceiling — still no error")
    }

    @Test
    fun reconcile_replays_queued_writes_before_reading() = runTest {
        // Order is load-bearing: reading first would return a balance that does not yet reflect the
        // queued writes, and the mirror would visibly bounce.
        val repo = repoWith(500)
        val store = PayCraftSettingsStore(MapSettings())
        store.enqueueEarn("evt-offline", SKU, 25)
        store.enqueueSpend("spend-offline", SKU, 100)

        balances(repo, store).reconcile(SKU)

        assertEquals(1, repo.earnCalls.size, "the queued earn must be replayed")
        assertEquals(1, repo.spendCalls.size, "the queued spend must be replayed")
        assertTrue(store.pendingEarns().isEmpty())
        assertTrue(store.pendingSpends().isEmpty())
    }

    @Test
    fun the_outbox_survives_a_new_store_instance() = runTest {
        // Process death. The whole point of persisting rather than holding them in memory: a write
        // made offline must still be there after a restart.
        val settings = MapSettings()
        PayCraftSettingsStore(settings).enqueueSpend("k-1", SKU, 100)

        val revived = PayCraftSettingsStore(settings).pendingSpends()
        assertEquals(1, revived.size)
        assertEquals("k-1", revived.single().id)
        assertEquals(100, revived.single().quantity)
    }

    @Test
    fun several_offline_spends_are_all_kept() = runTest {
        // A single-slot design would keep only the last. Each spend is its own idempotency key and
        // its own ledger row, so all of them have to survive.
        val store = PayCraftSettingsStore(MapSettings())
        store.enqueueSpend("k-1", SKU, 10)
        store.enqueueSpend("k-2", SKU, 20)
        store.enqueueSpend("k-3", SKU, 30)

        assertEquals(3, store.pendingSpends().size)
        assertEquals(60, store.pendingSpends().sumOf { it.quantity })
    }
}
