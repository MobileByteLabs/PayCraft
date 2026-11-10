package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.broadcastFlow
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject

/**
 * Realtime push layer for the SDK — turns PayCraft from cache-TTL polling into
 * live, event-driven refresh.
 *
 * Mechanism: **Supabase Realtime BROADCAST**, not table `postgres_changes`. The
 * end-user app has no Supabase-auth JWT (it authenticates to the backend with an
 * api key + identity-scoped RPCs), so it cannot satisfy table RLS for realtime.
 * Instead, DB triggers (`pc_broadcast_*`, migration 081) emit a lightweight
 * INVALIDATION PING — never row data — to two PUBLIC channels:
 *
 *   - `config:{tenantId}`                     → any paywall-config change for the tenant
 *   - `entitlement:{tenantId}:{appUserId}`    → this buyer's entitlement changed
 *
 * On a ping the SDK refetches through its EXISTING secure api-key/identity RPCs, so
 * no secret ever crosses the (public) channel and the ping is safe to be open.
 * This is what makes a removed trial/discount, a new purchase, a cancel, or a trial
 * expiry reflect in-app immediately instead of on the next cache-TTL window.
 *
 * Both `ensure*` calls are idempotent per (tenant, identity): calling again with the
 * same key is a no-op; calling with a NEW identity (e.g. after the buyer logs in and
 * `appUserId` flips from device-id to email) re-subscribes the entitlement channel.
 * Failures degrade silently — the existing TTL/foreground sync remains the fallback,
 * so realtime is strictly additive and never blocks the paywall.
 */
class PayCraftRealtime(private val supabase: SupabaseClient) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // All channel state is read/written ONLY inside [mutex] — this makes the
    // check-then-subscribe atomic (no duplicate channel when startRealtime is
    // called twice per config fetch) and the fields thread-safe across the
    // Default-dispatcher coroutines + the calling thread (JVM + Kotlin/Native).
    private val mutex = Mutex()
    private var configChannel: RealtimeChannel? = null
    private var entitlementChannel: RealtimeChannel? = null
    private var configTenant: String? = null
    private var entitlementKey: String? = null // "tenant:appUserId"

    // Remembered so [resubscribe] can rebuild both channels after a socket drop without the
    // caller having to re-supply them.
    private var configOnChanged: (() -> Unit)? = null
    private var entitlementOnChanged: (() -> Unit)? = null
    private var entitlementIdentity: Pair<String, String>? = null // (tenantId, appUserId)

    /**
     * Is this channel still actually receiving?
     *
     * The short-circuit used to test `channel != null`, which stays true forever once a channel has
     * been created — including after the socket drops on a network change or a long background.
     * Every later `ensure*` call then no-opped against a dead channel, so realtime silently stopped
     * and only the TTL fallback remained, with nothing surfacing that live sync was gone.
     */
    private val RealtimeChannel.isLive: Boolean
        get() = status.value == RealtimeChannel.Status.SUBSCRIBED

    /** Subscribe to `config:{tenantId}`; invoke [onChanged] on every config ping. */
    fun ensureConfigChannel(tenantId: String, onChanged: () -> Unit) {
        scope.launch {
            mutex.withLock {
                configOnChanged = onChanged
                if (configTenant == tenantId && configChannel?.isLive == true) return@withLock
                runCatching {
                    configChannel?.let { supabase.realtime.removeChannel(it) }
                    val ch = supabase.channel("config:$tenantId")
                    ch.broadcastFlow<JsonObject>(event = "config_changed")
                        .onEach {
                            PayCraftLogger.onFlow("realtime", "config ping → refetching /config")
                            onChanged()
                        }
                        .launchIn(scope)
                    ch.subscribe()
                    configChannel = ch
                    configTenant = tenantId
                    PayCraftLogger.onFlow("realtime", "subscribed config:$tenantId")
                }.onFailure {
                    PayCraftLogger.onFlow("realtime", "config subscribe failed (TTL fallback stays): ${it.message}")
                }
            }
        }
    }

    /** Subscribe to `entitlement:{tenantId}:{appUserId}`; re-subscribes on identity change. */
    fun ensureEntitlementChannel(tenantId: String, appUserId: String, onChanged: () -> Unit) {
        val key = "$tenantId:$appUserId"
        scope.launch {
            mutex.withLock {
                entitlementOnChanged = onChanged
                entitlementIdentity = tenantId to appUserId
                if (entitlementKey == key && entitlementChannel?.isLive == true) return@withLock
                runCatching {
                    entitlementChannel?.let { supabase.realtime.removeChannel(it) }
                    val ch = supabase.channel("entitlement:$tenantId:$appUserId")
                    ch.broadcastFlow<JsonObject>(event = "entitlement_changed")
                        .onEach {
                            PayCraftLogger.onFlow("realtime", "entitlement ping → force refresh")
                            onChanged()
                        }
                        .launchIn(scope)
                    ch.subscribe()
                    entitlementChannel = ch
                    entitlementKey = key
                    PayCraftLogger.onFlow("realtime", "subscribed entitlement:$tenantId:***")
                }.onFailure {
                    PayCraftLogger.onFlow(
                        "realtime",
                        "entitlement subscribe failed (TTL fallback stays): ${it.message}",
                    )
                }
            }
        }
    }

    /**
     * Force both channels to rebuild — call on app foreground.
     *
     * Foreground is the moment a socket dropped during background is most likely to be dead while
     * still looking present. Clearing the keys makes the next `ensure*` call rebuild rather than
     * short-circuit, and both are re-issued here from the remembered callbacks so the caller does
     * not have to know they were lost.
     */
    fun resubscribe() {
        scope.launch {
            val cfgTenant: String?
            val cfgCallback: (() -> Unit)?
            val entIdentity: Pair<String, String>?
            val entCallback: (() -> Unit)?
            mutex.withLock {
                cfgTenant = configTenant
                cfgCallback = configOnChanged
                entIdentity = entitlementIdentity
                entCallback = entitlementOnChanged
                configChannel?.let { runCatching { supabase.realtime.removeChannel(it) } }
                entitlementChannel?.let { runCatching { supabase.realtime.removeChannel(it) } }
                configChannel = null
                entitlementChannel = null
                configTenant = null
                entitlementKey = null
            }
            if (cfgTenant != null && cfgCallback != null) ensureConfigChannel(cfgTenant, cfgCallback)
            if (entIdentity != null && entCallback != null) {
                ensureEntitlementChannel(entIdentity.first, entIdentity.second, entCallback)
            }
        }
    }

    /** Tear down both channels (call on logout / SDK teardown). */
    fun stop() {
        scope.launch {
            mutex.withLock {
                configChannel?.let { runCatching { supabase.realtime.removeChannel(it) } }
                entitlementChannel?.let { runCatching { supabase.realtime.removeChannel(it) } }
                configChannel = null
                entitlementChannel = null
                configTenant = null
                entitlementKey = null
                configOnChanged = null
                entitlementOnChanged = null
                entitlementIdentity = null
            }
        }
    }
}
