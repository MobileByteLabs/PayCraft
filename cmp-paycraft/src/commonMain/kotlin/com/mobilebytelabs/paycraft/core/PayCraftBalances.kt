package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The spendable balance, owned end to end by the SDK.
 *
 * ## What replaced what
 *
 * This replaces `ConsumableGrantSink` + `ConsumableDrainer`, which asked the HOST to keep its own
 * ledger and drained the server's balance into it. That was two sources of truth for one currency:
 * the user saw the host's number, the server held a different one, and a reconciliation bug showed
 * up as money that vanished. It also had no room for a third earn source — an ad reward credited
 * server-side would have needed draining too, and one credited host-side would have been invisible
 * to the server.
 *
 * Now the server's `entitlement_balance_ledger` is the single record, and every source lands in it:
 *
 * ```
 *   purchase    store / PSP webhook
 *   ad_reward   ad-network SSV callback (server-verified)
 *   activity    the app's own earn events (capped server-side)
 *   spend       this class
 * ```
 *
 * The host keeps no ledger and writes no reconciliation. It reads [balanceOf] and calls [spend].
 *
 * ## Why there is still a local mirror
 *
 * A server-of-record balance would make every spend an online call, which breaks an app that works
 * offline — cappy's shop renders and spends with no network at all. Rather than push that problem
 * onto each consumer, the SDK holds the mirror and an outbox: a spend applies locally at once and
 * is replayed when the network returns.
 *
 * **The server always wins.** The mirror is a cache, never an authority: every reconcile overwrites
 * it with the server's number, including downward. A client that could decide its own balance would
 * be minting currency people pay real money for (AR-013), so nothing here computes a balance — it
 * only remembers the last one the server reported, adjusted by spends not yet acknowledged.
 *
 * ## The honest limit
 *
 * Two devices offline at once can both spend the same units, and the server will accept only what
 * exists. The second device's spend fails on reconcile and its balance corrects downward — the user
 * sees units they appeared to have disappear. That is acceptable for cosmetics and is NOT acceptable
 * for anything with real value, which is why a sku can opt out via [offlineSpendAllowed] and take
 * the online-only path instead.
 */
public class PayCraftBalances internal constructor(
    private val repository: PayCraftRepository,
    private val store: PayCraftStore,
    private val newIdempotencyKey: () -> String,
) {

    private val mirror = MutableStateFlow<Map<String, Int>>(emptyMap())

    /** Last known balance per sku — server truth, minus spends still in the outbox. */
    public val balances: StateFlow<Map<String, Int>> = mirror.asStateFlow()

    public fun balanceOf(sku: String): Int = mirror.value[sku] ?: 0

    /**
     * Spend [quantity] of [sku].
     *
     * Applies to the mirror immediately so the UI responds at once, and enqueues the server call.
     * Returns false ONLY when the local balance cannot cover it — an offline spend that the server
     * later rejects is reported through [reconcile], not here, because at call time there is no way
     * to know.
     *
     * @param offlineSpendAllowed when false this refuses rather than queueing while offline. Use it
     *   for anything whose over-spend cannot be forgiven; the default suits a cosmetic economy.
     */
    public suspend fun spend(
        sku: String,
        quantity: Int,
        offlineSpendAllowed: Boolean = true,
    ): Boolean {
        require(quantity >= 1) { "quantity must be >= 1" }
        if (balanceOf(sku) < quantity) return false

        val key = newIdempotencyKey()
        // Optimistic FIRST: the user sees the cost deducted as they tap, which is the whole point of
        // the mirror. The outbox row is written before the network call so a crash mid-flight
        // replays rather than losing the spend.
        mirror.value = mirror.value + (sku to (balanceOf(sku) - quantity))
        store.enqueueSpend(key, sku, quantity)

        val result = runCatching { repository.spend(sku, quantity, key) }.getOrNull()
        return when {
            result == null && !offlineSpendAllowed -> {
                // Online-only sku: undo and refuse rather than leave an unacknowledged debit.
                store.dequeueSpend(key)
                mirror.value = mirror.value + (sku to (balanceOf(sku) + quantity))
                false
            }
            result == null -> true // queued; reconcile replays it
            result.isSuccess -> {
                store.dequeueSpend(key)
                mirror.value = mirror.value + (sku to result.getOrDefault(balanceOf(sku)))
                true
            }
            else -> {
                // The server REFUSED (insufficient funds server-side). Drop the outbox row — a
                // retry would be refused identically — and let reconcile restore the true number.
                store.dequeueSpend(key)
                PayCraftLogger.onError("balance", "spend refused for $sku; reconciling")
                reconcile(sku)
                false
            }
        }
    }

    /**
     * Report an in-app earn (a completed focus session, a streak). Safe to call offline — it is
     * queued and replayed.
     *
     * [eventId] must be STABLE for the activity that caused it, because it IS the idempotency key:
     * replaying a sync must not pay twice. The server clamps to the tenant's daily cap, so the
     * returned balance may rise by less than [quantity] — that is the cap working, not an error.
     */
    public suspend fun earn(sku: String, quantity: Int, eventId: String): Int {
        require(quantity >= 1) { "quantity must be >= 1" }
        require(eventId.isNotBlank()) { "eventId is required — it is the idempotency key" }

        store.enqueueEarn(eventId, sku, quantity)
        val result = runCatching { repository.earn(sku, quantity, eventId) }.getOrNull()
        if (result != null) {
            store.dequeueEarn(eventId)
            mirror.value = mirror.value + (sku to result)
            return result
        }
        // Offline: show it optimistically. The server's clamp may lower it on reconcile, which is
        // the correct direction to be wrong in — better to over-show briefly than to hide earned
        // units until the next connection.
        val optimistic = balanceOf(sku) + quantity
        mirror.value = mirror.value + (sku to optimistic)
        return optimistic
    }

    /**
     * Drain the outbox and adopt the server's number. Safe to call on every start and foreground.
     *
     * Order matters: queued writes are replayed BEFORE the read, or the read would return a balance
     * that does not yet reflect them and the mirror would bounce.
     */
    public suspend fun reconcile(sku: String) {
        store.pendingEarns().filter { it.sku == sku }.forEach { pending ->
            runCatching { repository.earn(pending.sku, pending.quantity, pending.id) }
                .onSuccess { store.dequeueEarn(pending.id) }
        }
        store.pendingSpends().filter { it.sku == sku }.forEach { pending ->
            runCatching { repository.spend(pending.sku, pending.quantity, pending.id) }
                .onSuccess { store.dequeueSpend(pending.id) }
        }
        runCatching { repository.refreshBalance(sku) }
            .onSuccess { mirror.value = mirror.value + (sku to it) }
    }

    /** Reconcile every consumable sku in the catalogue. */
    public suspend fun reconcileAll() {
        repository.plans.value.filter { it.isConsumable }.forEach { reconcile(it.sku) }
    }
}
