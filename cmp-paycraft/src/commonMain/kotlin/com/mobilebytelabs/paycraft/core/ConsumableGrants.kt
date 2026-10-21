package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.repository.PayCraftRepository

/**
 * Where purchased consumable units go in the HOST app.
 *
 * The host states only this: "credit [quantity] of [sku] under [grantId]". Everything else — which
 * skus are consumable, when a balance appears, debiting the server, retrying after a crash — is the
 * SDK's, because every one of those is an invariant of the SDK rather than of the app.
 *
 * @param grantId a STABLE id for this grant. Credit idempotently on it: the sink can be invoked
 *   again for the same grant after a crash or a provider redelivery, and must not double-credit.
 *   Using it as the primary key of the host's own ledger row is the intended shape.
 * @return true when the host has DURABLY committed the credit. Returning false (or throwing) keeps
 *   the grant pending so the next drain retries it — the SDK will not drop it.
 */
public fun interface ConsumableGrantSink {
    public suspend fun credit(sku: String, quantity: Int, grantId: String): Boolean
}

/**
 * Moves purchased consumable units out of the server-held balance and into the host, exactly once.
 *
 * ## Why this lives in the SDK
 *
 * A host that did this itself would have to know: which of its products are consumable, that the
 * balance is server-authoritative and must be debited rather than decremented, that the debit needs
 * a caller-owned idempotency key, and that a crash between the debit and the host's own write is
 * the ordinary case rather than an exotic one. Those are facts about PayCraft, not about the app —
 * and the first host to implement them wrote 118 lines to do it, which is the same shape as the
 * `PayCraftBootstrap` that `payCraft(...)` replaced.
 *
 * ## The part that must not go wrong
 *
 * A drain is two writes against different systems, and either order has a failure mode:
 * credit-then-debit DOUBLE-CREDITS on retry (free units for a crash), debit-then-credit LOSES the
 * purchase if the crash lands between them. Neither is acceptable for something a customer paid
 * for, so the intent is persisted BEFORE the server is touched:
 *
 *   1. persist `(grantId, sku, quantity)` — durable across process death
 *   2. `spend(sku, quantity, idempotencyKey = grantId)` — debits the server
 *   3. invoke the host [ConsumableGrantSink] with the same `grantId`
 *   4. clear the intent
 *
 * Resume replays from (2) with the same id: the server recognises the replay and returns the
 * original balance rather than debiting twice, and the host is asked to credit idempotently on the
 * same key. Every step is therefore safe to repeat, which is the only property that makes a
 * two-system transfer survivable without a distributed transaction.
 *
 * The host never chooses the amount. The SDK drains exactly what the server says is there — a
 * number the client cannot influence (AR-013).
 */
internal class ConsumableDrainer(
    private val repository: PayCraftRepository,
    private val store: PayCraftStore,
    private val sink: ConsumableGrantSink,
    private val newGrantId: () -> String,
) {

    /**
     * Collect anything outstanding. Safe to call on every start, after a purchase returns, and on a
     * foreground: with nothing pending and a zero balance it is one cheap read per consumable sku.
     *
     * Never throws — a failure leaves the intent persisted and returns what was credited so far.
     */
    suspend fun drain(): Int {
        var credited = runCatching { resumePending() }.getOrDefault(0)

        // An intent still here after the resume means it did NOT settle — the server refused the
        // debit, or the host could not commit one that already went through. Either way the store
        // holds exactly one intent, so going on to the loop would OVERWRITE it with a fresh grant
        // and lose units the customer already paid for. Leave it and retry on the next drain; a
        // genuine new balance is still there to find then.
        if (store.getConsumablePending() != null) return credited

        for (sku in repository.plans.value.filter { it.isConsumable }.map { it.sku }) {
            val available = runCatching { repository.refreshBalance(sku) }.getOrDefault(0)
            if (available <= 0) continue

            val grantId = newGrantId()
            // Persisted BEFORE the server is touched: after this line a crash anywhere is
            // recoverable, because the next drain knows the key, the sku and the amount.
            store.saveConsumablePending(grantId, sku, available)

            credited += runCatching { settle(grantId, sku, available) }.getOrDefault(0)
        }
        return credited
    }

    private suspend fun resumePending(): Int {
        val pending = store.getConsumablePending() ?: return 0
        return settle(pending.grantId, pending.sku, pending.quantity)
    }

    private suspend fun settle(grantId: String, sku: String, quantity: Int): Int {
        val spent = repository.spend(sku = sku, quantity = quantity, idempotencyKey = grantId)
        if (spent.isFailure) {
            // Offline, or the server refused. The intent stays persisted and the next drain retries
            // under the same key — never a host credit for units the server still holds.
            PayCraftLogger.onError("consumable-drain", "spend failed for $sku; will retry")
            return 0
        }

        val committed = runCatching { sink.credit(sku, quantity, grantId) }.getOrDefault(false)
        if (!committed) {
            // The host could not durably record it. Keep the intent: the server is already debited,
            // so dropping this would lose units the customer paid for. The replay is safe because
            // the host is required to credit idempotently on grantId.
            PayCraftLogger.onError("consumable-drain", "host did not commit $quantity of $sku; will retry")
            return 0
        }

        clear()
        return quantity
    }

    private fun clear() = store.clearConsumablePending()
}
