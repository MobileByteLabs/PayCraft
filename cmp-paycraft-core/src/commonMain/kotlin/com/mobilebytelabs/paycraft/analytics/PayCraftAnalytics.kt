package com.mobilebytelabs.paycraft.analytics

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.concurrent.Volatile

/**
 * Receives every paywall event the SDK emits, so the app can forward it to its own analytics — typically one
 * line into Firebase / GA4 (GOAL D2): `PayCraft.analyticsListener = PayCraftAnalyticsListener { name, params ->
 * analytics.logEvent(name, params) }`. Names and params are already GA4-valid ([PayCraftEvent]).
 */
public fun interface PayCraftAnalyticsListener {
    public fun onEvent(name: String, params: Map<String, String>)
}

/**
 * Hands each [PayCraftEvent] to the host's [listener] at once and queues it for PayCraft's own `events`
 * endpoint (the exact funnel the dashboard shows). The queue is bounded — an offline buyer keeps the newest
 * [maxQueue] events, never unbounded memory — and is sent in batches of [maxBatch]: by [flush], and every
 * `flushMs` once [start]ed. A failed send drops that batch rather than retrying forever.
 */
public class PayCraftAnalytics internal constructor(
    private val send: suspend (List<PayCraftEvent>) -> Unit,
    private val maxBatch: Int = 20,
    maxQueue: Int = 200,
) {
    /** The app's analytics forwarder; null = none. A throwing listener is ignored — it never breaks the paywall. */
    @Volatile
    public var listener: PayCraftAnalyticsListener? = null

    /**
     * The app's consent for PayCraft's first-party event store (GOAL D10). Off → nothing leaves the device; the
     * [listener] still receives every event, so the app applies its own consent to what it forwards.
     */
    @Volatile
    public var ingestEnabled: Boolean = true

    private val queue = Channel<PayCraftEvent>(capacity = maxQueue, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private var loop: Job? = null

    public fun emit(event: PayCraftEvent) {
        runCatching { listener?.onEvent(event.name.wire, event.params()) }
        if (ingestEnabled) queue.trySend(event)
    }

    /** Sends everything queued now, in batches. Never throws. */
    public suspend fun flush() {
        while (true) {
            val batch = buildList {
                while (size < maxBatch) add(queue.tryReceive().getOrNull() ?: break)
            }
            if (batch.isEmpty()) return
            runCatching { send(batch) }
        }
    }

    /** Flushes every [flushMs] in [scope] until [stop]. Idempotent. */
    internal fun start(scope: CoroutineScope, flushMs: Long = 5_000) {
        if (loop?.isActive == true) return
        loop = scope.launch {
            while (isActive) {
                delay(flushMs)
                flush()
            }
        }
    }

    internal fun stop() {
        loop?.cancel()
        loop = null
    }
}
