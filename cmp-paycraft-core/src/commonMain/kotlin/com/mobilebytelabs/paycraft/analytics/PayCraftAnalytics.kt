package com.mobilebytelabs.paycraft.analytics

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
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
 * endpoint (the exact funnel the dashboard shows, and the purchase-attempt timelines).
 *
 * Delivery is complete, not best-effort (paycraft-attempt-observability D14): a batch the ingest did not take
 * stays queued and is retried with exponential backoff — 1 s, 2 s, 4 s … capped at 5 minutes — by [flush] and
 * every `flushMs` while anything is queued once [start]ed (no timer while idle). With [settings] the queue is persisted after every flush, so it survives the app
 * being killed. It is bounded at [maxQueue] events, dropping the OLDEST, so an offline buyer never grows memory or
 * storage without limit. Two kinds of event are dropped rather than retried, because no retry can deliver them:
 * one the server refused by name ([Rejected], e.g. a catalog name an older server does not know — the rest of its
 * batch still goes), and one older than the ingest's 7-day clock window.
 */
public class PayCraftAnalytics internal constructor(
    private val send: suspend (List<PayCraftEvent>) -> Unit,
    private val maxBatch: Int = 20,
    private val maxQueue: Int = DEFAULT_MAX_QUEUE,
    /** Where the queue lives between launches; null keeps it in memory only. */
    private val settings: Settings? = null,
    private val now: () -> Long = ::currentTimeMillis,
    /** Fills what every event carries regardless of who emits it — the app version, build and OS version. */
    private val stamp: (PayCraftEvent) -> PayCraftEvent = { it },
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

    /**
     * The server refused a batch as malformed (HTTP 4xx). [unknownEventName] names the one event it would not take,
     * when it said which — that event is dropped and the rest of the batch re-sent; otherwise the batch is dropped.
     */
    internal class Rejected(val unknownEventName: String?) : Exception("events refused: ${unknownEventName ?: "batch"}")

    // emit() may be called from any thread and never suspends, so new events land in this lock-free buffer; flush()
    // moves them into the ordered, persisted queue under [lock].
    private val inbox = Channel<PayCraftEvent>(capacity = maxQueue, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val lock = Mutex()
    private val queue = ArrayDeque<PayCraftEvent>()
    private var failures = 0
    private var nextAttemptAtMs = 0L
    private var loop: Job? = null

    init {
        settings?.let { s ->
            queue.addAll(readQueue(s))
            failures = s.getInt(KEY_FAILURES, 0)
            nextAttemptAtMs = s.getLong(KEY_NEXT_ATTEMPT, 0L)
            dropExpired()
        }
    }

    public fun emit(event: PayCraftEvent) {
        val stamped = runCatching { stamp(event) }.getOrDefault(event)
        runCatching { listener?.onEvent(stamped.name.wire, stamped.params()) }
        if (ingestEnabled) {
            inbox.trySend(stamped)
            kick()
        }
    }

    /**
     * Sends what is queued, in batches, unless the last failure's backoff has not passed yet. Never throws; what
     * is left over (a failed send) stays queued for the next flush.
     */
    public suspend fun flush() {
        lock.withLock {
            while (true) queue.addLast(inbox.tryReceive().getOrNull() ?: break)
            while (queue.size > maxQueue) queue.removeFirst()
            try {
                if (queue.isNotEmpty() && now() >= nextAttemptAtMs) drain()
            } finally {
                persist()
            }
        }
    }

    private suspend fun drain() {
        while (queue.isNotEmpty()) {
            val batch = queue.take(maxBatch)
            try {
                send(batch)
                repeat(batch.size) { queue.removeFirst() }
                failures = 0
                nextAttemptAtMs = 0L
            } catch (e: Rejected) {
                val refused = e.unknownEventName
                val drop = if (refused == null) batch else batch.filter { it.name.wire == refused }.ifEmpty { batch }
                queue.removeAll { it in drop }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                failures++
                nextAttemptAtMs = now() + backoffMs(failures)
                dropExpired()
                return
            }
        }
    }

    /**
     * Drops what waited past the ingest's clock window — checked on what is carried over (restored from [settings],
     * or kept after a failed send), never on what was just emitted.
     */
    private fun dropExpired() {
        val oldest = now() - MAX_EVENT_AGE_MS
        queue.removeAll { it.atMs < oldest }
    }

    private fun persist() {
        val s = settings ?: return
        if (queue.isEmpty()) s.remove(KEY_QUEUE) else s.putString(KEY_QUEUE, JsonArray(queue.map(::encode)).toString())
        s.putInt(KEY_FAILURES, failures)
        s.putLong(KEY_NEXT_ATTEMPT, nextAttemptAtMs)
    }

    /**
     * Enables delivery in [scope]: from now on a flush runs every [flushMs] WHILE something is queued, and stops
     * when the queue is empty — an idle SDK holds no timer (a forever-loop kept Node test processes from exiting).
     * Drains a queue restored from [settings] straight away. Idempotent; events emitted before [start] wait.
     */
    internal fun start(scope: CoroutineScope, flushMs: Long = 5_000) {
        this.scope = scope
        this.flushMs = flushMs
        kick()
    }

    internal fun stop() {
        scope = null
        loop?.cancel()
        loop = null
    }

    private var scope: CoroutineScope? = null
    private var flushMs: Long = 5_000

    /** Starts the drain loop when delivery is enabled, nothing is draining, and there is something to send. */
    // Channel.isEmpty is a snapshot check; a send that races it is caught by the re-kick below.
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun kick() {
        val s = scope ?: return
        if (loop?.isActive == true) return
        if (queue.isEmpty() && inbox.isEmpty) return
        val job = s.launch {
            while (isActive) {
                delay(flushMs)
                flush()
                if (lock.withLock { queue.isEmpty() } && inbox.isEmpty) break
            }
        }
        loop = job
        // An event emitted between the loop's last emptiness check and its completion would otherwise wait for
        // the next emit; re-kick once the job is done.
        job.invokeOnCompletion { cause -> if (cause == null && !inbox.isEmpty) kick() }
    }

    internal companion object {
        const val DEFAULT_MAX_QUEUE = 500
        const val KEY_QUEUE = "paycraft.analytics.queue"
        const val KEY_FAILURES = "paycraft.analytics.failures"
        const val KEY_NEXT_ATTEMPT = "paycraft.analytics.next_attempt_ms"

        /** The ingest refuses an event more than 7 days off its clock; an hour's margin for device clock skew. */
        const val MAX_EVENT_AGE_MS = 7L * 86_400_000L - 3_600_000L
        private const val MAX_BACKOFF_MS = 5L * 60_000L
        private const val BASE_BACKOFF_MS = 1_000L

        /** The wait after the [failures]-th consecutive failure: 1 s doubling, never more than 5 minutes. */
        fun backoffMs(failures: Int): Long =
            minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L shl (failures - 1).coerceIn(0, 9)))

        /** The persisted queue as [settings] holds it (oldest first). Unreadable entries are skipped. */
        fun readQueue(s: Settings): List<PayCraftEvent> {
            val raw = s.getStringOrNull(KEY_QUEUE) ?: return emptyList()
            val array = runCatching { Json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return emptyList()
            return array.mapNotNull { runCatching { decode(it.jsonObject) }.getOrNull() }
        }

        private fun encode(e: PayCraftEvent): JsonObject = buildJsonObject {
            put("name", e.name.wire)
            put("step", e.step.wire)
            put("platform", e.platform)
            e.trigger?.let { put("trigger", it) }
            e.sku?.let { put("sku", it) }
            e.currency?.let { put("currency", it) }
            e.country?.let { put("country", it) }
            e.provider?.let { put("provider", it) }
            e.reason?.let { put("reason", it) }
            put("at", e.atMs)
            e.experiment?.let { put("experiment", it) }
            e.variant?.let { put("variant", it) }
            e.attemptId?.let { put("attempt_id", it) }
            e.appVersion?.let { put("app_version", it) }
            e.appBuild?.let { put("app_build", it) }
            e.osVersion?.let { put("os_version", it) }
            e.failure?.let { f ->
                put("f_stage", f.stage.wire)
                put("f_class", f.errorClass)
                put("f_code", f.code)
                put("f_message", f.message)
            }
        }

        private fun decode(o: JsonObject): PayCraftEvent? {
            fun str(key: String) = (o[key] as? JsonPrimitive)?.contentOrNull
            val name = PayCraftEventName.entries.firstOrNull { it.wire == str("name") } ?: return null
            val step = PayCraftStep.entries.firstOrNull { it.wire == str("step") } ?: return null
            val stage = PayCraftFailureStage.entries.firstOrNull { it.wire == str("f_stage") }
            return PayCraftEvent(
                name = name,
                step = step,
                platform = str("platform") ?: return null,
                trigger = str("trigger"),
                sku = str("sku"),
                currency = str("currency"),
                country = str("country"),
                provider = str("provider"),
                reason = str("reason"),
                atMs = o["at"]?.jsonPrimitive?.longOrNull ?: return null,
                experiment = str("experiment"),
                variant = str("variant"),
                attemptId = str("attempt_id"),
                appVersion = str("app_version"),
                appBuild = o["app_build"]?.jsonPrimitive?.longOrNull,
                osVersion = str("os_version"),
                failure = stage?.let {
                    PayCraftFailure(it, str("f_class").orEmpty(), str("f_code").orEmpty(), str("f_message").orEmpty())
                },
            )
        }
    }
}
