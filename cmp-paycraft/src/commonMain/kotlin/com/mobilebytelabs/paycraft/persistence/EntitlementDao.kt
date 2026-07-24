package com.mobilebytelabs.paycraft.persistence

import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.network.canonicalStateOf
import com.russhwolf.settings.Settings
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Persistence contract that backs the Store5 [EntitlementCache] `SourceOfTruth` — the offline
 * last-known-good store for the reconciled entitlement (D8, AC9).
 *
 * The three methods are the ONLY entitlement write/read surface: the Store5 `SourceOfTruth.of`
 * reader/writer/delete lambdas are their sole call site (RULE-IMPLEMENT-STORE5-001 S5-1 — no
 * mutation bypasses the Store). Keeping this an interface lets the reconciled row be persisted
 * by the multiplatform-settings-backed [SettingsEntitlementDao] today and by
 * the SQLDelight-generated `PayCraftDb.entitlementQueries` (schema: `Entitlement.sq`) once the
 * SQLDelight driver + code-gen land alongside the native clients (Phase 3 / platform layer).
 */
interface EntitlementDao {
    /** Reactive read of the single reconciled row for [appUserId] (null until first reconcile). */
    fun selectByUser(appUserId: String): Flow<Entitlement?>

    /** Insert-or-replace the reconciled row (the offline last-known-good). */
    suspend fun upsert(entitlement: Entitlement)

    /** Remove the row on logout / entitlement revoke. */
    suspend fun deleteByUser(appUserId: String)
}

/**
 * `multiplatform-settings`-backed [EntitlementDao] — a real cross-platform, process-death-durable
 * offline SoT that runs on ALL six targets today (mirrors how [PayCraftSettingsStore] already
 * persists the legacy subscription cache). The reconciled row is stored as JSON keyed by
 * app-user-id; an in-memory [MutableStateFlow] per key makes reads reactive so the Store5
 * `SourceOfTruth` emits fresh values the instant the writer runs.
 *
 * Column semantics match `Entitlement.sq` 1:1, so the SQLDelight-backed DAO is a drop-in
 * replacement (same interface) once its driver is wired.
 */
class SettingsEntitlementDao(
    private val settings: Settings = Settings(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) : EntitlementDao {

    private val flows = mutableMapOf<String, MutableStateFlow<Entitlement?>>()

    private fun flowFor(appUserId: String): MutableStateFlow<Entitlement?> =
        flows.getOrPut(appUserId) { MutableStateFlow(readPersisted(appUserId)) }

    override fun selectByUser(appUserId: String): Flow<Entitlement?> = flowFor(appUserId)

    override suspend fun upsert(entitlement: Entitlement) {
        settings.putString(keyFor(entitlement.userId), json.encodeToString(entitlement.toRow()))
        flowFor(entitlement.userId).value = entitlement
    }

    override suspend fun deleteByUser(appUserId: String) {
        settings.remove(keyFor(appUserId))
        flowFor(appUserId).value = null
    }

    private fun readPersisted(appUserId: String): Entitlement? = settings.getStringOrNull(keyFor(appUserId))
        ?.let { runCatching { json.decodeFromString<EntitlementRow>(it).toEntitlement() }.getOrNull() }

    private fun keyFor(appUserId: String) = "$KEY_PREFIX$appUserId"

    private companion object {
        const val KEY_PREFIX = "paycraft_entitlement_"
    }
}

/**
 * JSON persistence row — column-for-column with `Entitlement.sq`. Kept distinct from the
 * canonical [Entitlement] so the sealed [SubscriptionState] is stored as its stable canonical
 * token (via [canonicalStateOf]) rather than requiring a polymorphic serializer on the model.
 */
@Serializable
internal data class EntitlementRow(
    val appUserId: String,
    val provider: String,
    val productId: String,
    val canonicalState: String,
    val expiresAt: String? = null,
    val inGraceUntil: String? = null,
    val subscriptionId: String? = null,
    val willRenew: Boolean = true,
    val isSandbox: Boolean = false,
    val latestEventTs: Long = 0L,
)

internal fun Entitlement.toRow(): EntitlementRow = EntitlementRow(
    appUserId = userId,
    provider = provider,
    productId = product,
    canonicalState = canonicalState.canonicalToken(),
    expiresAt = expiresAt,
    inGraceUntil = inGraceUntil,
    subscriptionId = subscriptionId,
    willRenew = willRenew,
    isSandbox = isSandbox,
    latestEventTs = latestEventTs,
)

internal fun EntitlementRow.toEntitlement(): Entitlement = Entitlement(
    userId = appUserId,
    provider = provider,
    product = productId,
    canonicalState = canonicalStateOf(canonicalState),
    expiresAt = expiresAt,
    willRenew = willRenew,
    inGraceUntil = inGraceUntil,
    isSandbox = isSandbox,
    subscriptionId = subscriptionId,
    latestEventTs = latestEventTs,
)

/** Stable canonical token for persistence — inverse of [canonicalStateOf]. */
internal fun SubscriptionState.canonicalToken(): String = when (this) {
    SubscriptionState.Trial -> "trial"
    SubscriptionState.Active -> "active"
    SubscriptionState.ActiveNonRenewing -> "active_non_renewing"
    SubscriptionState.InGracePeriod -> "in_grace_period"
    SubscriptionState.OnBillingRetry -> "on_billing_retry"
    SubscriptionState.Paused -> "paused"
    SubscriptionState.Expired -> "expired"
    SubscriptionState.Cancelled -> "cancelled"
    SubscriptionState.Refunded -> "refunded"
    SubscriptionState.Pending -> "pending"
}
