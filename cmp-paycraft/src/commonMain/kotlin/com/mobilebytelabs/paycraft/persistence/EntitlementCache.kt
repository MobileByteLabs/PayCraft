package com.mobilebytelabs.paycraft.persistence

import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.toEntitlement
import kotlinx.coroutines.flow.first
import org.mobilenativefoundation.store.store5.Fetcher
import org.mobilenativefoundation.store.store5.MemoryPolicy
import org.mobilenativefoundation.store.store5.SourceOfTruth
import org.mobilenativefoundation.store.store5.Store
import org.mobilenativefoundation.store.store5.StoreBuilder
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** Store5 cache key — the STABLE app-user-id (D5), NOT the store account. */
data class EntitlementKey(val appUserId: String)

/**
 * Store5 read-through cache for the reconciled entitlement (D8, AC9).
 *
 * Topology (single source of gating truth):
 * ```
 *   Fetcher.of  ── PayCraftService.getEntitlements(appUserId)   (server-authoritative /entitlements)
 *        │
 *   StoreBuilder.from(fetcher, sourceOfTruth)
 *        │
 *   SourceOfTruth.of  ──── EntitlementDao (SQLDelight-shaped, settings-backed today)
 *        └── the OFFLINE last-known-good — served when the fetcher fails (network loss)
 * ```
 *
 * RULE-IMPLEMENT-STORE5-001 conformance:
 *  - a **read-only** [Store] (never a `MutableStore`), so the ONLY entitlement DAO write sites
 *    are the `SourceOfTruth.of` `writer`/`delete` lambdas below (S5-1 floor);
 *  - a `MemoryPolicy` TTL bounds in-memory freshness ([ttl]); past TTL the SoT still serves the
 *    durable last-known-good so gating survives offline;
 *  - the dual cached/fresh read paths live on
 *    [com.mobilebytelabs.paycraft.core.EntitlementRepository] (`stream`/`streamFresh`, S5-DUAL).
 */
class EntitlementCache(
    private val service: PayCraftService,
    private val dao: EntitlementDao,
    private val ttl: Duration = 24.hours,
) {
    val store: Store<EntitlementKey, Entitlement> = buildStore()

    private fun buildStore(): Store<EntitlementKey, Entitlement> {
        val fetcher: Fetcher<EntitlementKey, Entitlement> = Fetcher.of { key ->
            service.getEntitlements(key.appUserId)?.toEntitlement()
                ?: error("no-entitlement-for:${key.appUserId}")
        }
        val sourceOfTruth: SourceOfTruth<EntitlementKey, Entitlement, Entitlement> =
            SourceOfTruth.of<EntitlementKey, Entitlement, Entitlement>(
                nonFlowReader = { key: EntitlementKey -> dao.selectByUser(key.appUserId).first() },
                writer = { _: EntitlementKey, entitlement: Entitlement -> dao.upsert(entitlement) },
                delete = { key: EntitlementKey -> dao.deleteByUser(key.appUserId) }, // ONLY DAO write sites (S5-1)
                deleteAll = { }, // one row per key; no bulk-clear semantics for this cache
            )
        return StoreBuilder
            .from(fetcher, sourceOfTruth)
            .cachePolicy(
                MemoryPolicy.builder<EntitlementKey, Entitlement>()
                    .setExpireAfterWrite(ttl)
                    .build(),
            )
            .build()
    }

    /**
     * Offline gating decision (AC9): may we serve [entitlement] as ACTIVE right now, using only
     * the last-known-good record?  True iff the canonical state is active (grace = active,
     * billing-retry = inactive — D6) AND we are still inside the paid-through window or the
     * grace window. This is what lets premium survive a network outage without ever over-serving
     * an expired/on-hold subscription.
     */
    @OptIn(ExperimentalTime::class)
    fun isServableOffline(entitlement: Entitlement, now: Long): Boolean {
        val expiresAtMs = entitlement.expiresAt.toEpochMillisOrNull()
        val inGraceUntilMs = entitlement.inGraceUntil.toEpochMillisOrNull()
        val withinWindow =
            (expiresAtMs != null && now < expiresAtMs) || (inGraceUntilMs != null && now < inGraceUntilMs)
        return entitlement.canonicalState.isActive && withinWindow
    }
}

/** Parse an ISO-8601 instant to epoch-millis, or null if absent/unparseable. */
@OptIn(ExperimentalTime::class)
internal fun String?.toEpochMillisOrNull(): Long? =
    this?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }
