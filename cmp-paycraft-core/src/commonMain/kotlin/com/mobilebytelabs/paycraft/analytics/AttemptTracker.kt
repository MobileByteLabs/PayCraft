package com.mobilebytelabs.paycraft.analytics

import com.mobilebytelabs.paycraft.PayCraftInternalApi
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlin.concurrent.Volatile
import kotlin.random.Random

/**
 * Holds the CURRENT purchase attempt (paycraft-attempt-observability GOAL D4): the one id every paywall event,
 * the checkout request, the Play purchase (`obfuscatedProfileId`) and the store registration carry, so the server
 * joins them into a single timeline without guessing.
 *
 * - [start] — a plan was picked: mint a new id. An attempt still open for another pick is closed first with a
 *   [PayCraftEventName.AttemptAbandon] event (`sdk / flow_switch / new_plan_select`), so its timeline ends.
 * - [ensure] — a checkout is starting: join the open attempt for this plan, or open one (headless apps call
 *   checkout without the paywall's plan pick).
 * - [granted] — premium arrived: clears it. An abandon or a failure does NOT end it: the buyer retrying the same
 *   plan is still the same attempt (the server's state machine allows `abandoned/failed → granted`), and the resume
 *   reminder brings them back into it.
 *
 * [newId] mints the id: the apps use [mintAttemptId] (`<epoch millis>-<16 hex>`, the shape `record_store_attempt`
 * already received), the browser a `crypto.randomUUID()`. Either fits the server's
 * `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$` and Play's 64-character profile-id limit, and neither is derived from the buyer.
 * No parameter has a default, so a bundle that never mints the app way (the web SDK) does not carry it.
 */
@PayCraftInternalApi
class AttemptTracker(
    private val now: () -> Long,
    private val newId: () -> String,
    private val platform: () -> String,
    private val emit: (PayCraftEvent) -> Unit,
) {
    /** The open attempt's id, or null when none is open. */
    @Volatile
    var current: String? = null
        private set

    /** The plan the open attempt is for. */
    @Volatile
    var currentSku: String? = null
        private set

    /** A plan was picked: closes any attempt still open for another plan, then opens a new one. Returns its id. */
    fun start(sku: String?): String {
        current?.let { previous -> emit(abandonEvent(previous, currentSku)) }
        val id = newId()
        current = id
        currentSku = sku
        return id
    }

    /**
     * The attempt a checkout for [sku] belongs to: the open one when it is for the same plan (or [sku] is unknown),
     * else a new one via [start].
     */
    fun ensure(sku: String?): String {
        val open = current
        if (open != null && (sku == null || currentSku == null || currentSku == sku)) {
            if (currentSku == null) currentSku = sku
            return open
        }
        return start(sku)
    }

    /** Premium arrived: the attempt is over, and the next plan pick starts a new one. */
    fun granted() {
        current = null
        currentSku = null
    }

    private fun abandonEvent(attemptId: String, sku: String?) = PayCraftEvent(
        name = PayCraftEventName.AttemptAbandon,
        step = PayCraftStep.Plan,
        platform = platform(),
        sku = sku,
        atMs = now(),
        attemptId = attemptId,
        failure = PayCraftFailure(PayCraftFailureStage.Sdk, "flow_switch", "new_plan_select"),
    )
}

/** A fresh attempt id: `<epoch millis>-<16 random hex>`. */
@PayCraftInternalApi
fun mintAttemptId(atMs: Long = currentTimeMillis()): String =
    "$atMs-${Random.nextLong().toULong().toString(16).padStart(16, '0')}"
