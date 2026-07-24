package com.mobilebytelabs.paycraft.testsupport

import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.billing.NativePurchaseResult
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.network.EntitlementDto
import com.mobilebytelabs.paycraft.network.OtpGateResult
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.persistence.EntitlementDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * In-memory [EntitlementDao] for hermetic canaries — a reactive SoT with no driver/persistence
 * (the settings-backed production DAO and the SQLDelight one both satisfy the same contract).
 */
class InMemoryEntitlementDao : EntitlementDao {
    private val flows = mutableMapOf<String, MutableStateFlow<Entitlement?>>()
    private fun flowFor(appUserId: String) = flows.getOrPut(appUserId) { MutableStateFlow(null) }

    override fun selectByUser(appUserId: String): Flow<Entitlement?> = flowFor(appUserId)
    override suspend fun upsert(entitlement: Entitlement) {
        flowFor(entitlement.userId).value = entitlement
    }
    override suspend fun deleteByUser(appUserId: String) {
        flowFor(appUserId).value = null
    }
}

/**
 * Fake [PayCraftService] whose entitlement fetch honours a [networkUp] switch: when the network
 * is down [getEntitlements] THROWS (as the real Supabase call does), so the Store5 SoT fallback
 * is exercised. [cancelledProviders] records every PSP cancel dispatch for the cancel-dispatch test.
 */
class FakePayCraftService(
    var networkUp: Boolean = true,
    private val entitlements: MutableMap<String, EntitlementDto> = mutableMapOf(),
) : PayCraftService {

    val cancelledProviders = mutableListOf<String>()

    fun seed(dto: EntitlementDto) {
        entitlements[dto.appUserId] = dto
    }

    override suspend fun getEntitlements(appUserId: String): EntitlementDto? {
        if (!networkUp) error("offline: get_entitlements unavailable")
        return entitlements[appUserId]
    }

    override suspend fun cancelSubscription(provider: String, subscriptionId: String): Boolean {
        cancelledProviders += provider
        return true
    }

    // ─── Unused surface for these tests — minimal deterministic stubs ─────────
    override suspend fun isPremium(serverToken: String): Boolean = false
    override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
    override suspend fun isTrialEligible(serverToken: String): Boolean = true
    override suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
    ): RegisterDeviceResult = RegisterDeviceResult("token", false, null, null)
    override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult =
        PremiumCheckResult(isPremium = false, tokenValid = true)
    override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = true
    override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean = true
    override suspend fun checkOtpGate(): OtpGateResult = OtpGateResult(available = false, sendsToday = 0, limit = 300)
    override suspend fun sendOtp(email: String) = Unit
    override suspend fun verifyOtp(email: String, token: String): Boolean = false
    override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
}

/** Spy [NativeBillingClient] recording sync/restore/manage dispatch for restore + cancel tests. */
class SpyNativeBillingClient : NativeBillingClient {
    var syncCalls = 0
    var restoreCalls = 0
    var manageCalls = 0
    val manageProductIds = mutableListOf<String?>()

    override suspend fun purchase(productId: String): NativePurchaseResult = NativePurchaseResult.Cancelled
    override suspend fun queryPurchases(): List<NativePurchase> = emptyList()
    override suspend fun sync() {
        syncCalls++
    }
    override suspend fun restore(): List<NativePurchase> {
        restoreCalls++
        return emptyList()
    }
    override suspend fun manageSubscription(productId: String?) {
        manageCalls++
        manageProductIds += productId
    }
}

/** Build a wire [EntitlementDto] (epoch-millis timestamps) for tests. */
fun entitlementDto(
    appUserId: String,
    provider: String = "stripe",
    productId: String = "pro_monthly",
    canonicalState: String = "active",
    expiresAt: Long? = null,
    inGraceUntil: Long? = null,
    subscriptionId: String? = "sub_test",
    latestEventTs: Long = 1_000L,
): EntitlementDto = EntitlementDto(
    appUserId = appUserId,
    provider = provider,
    productId = productId,
    canonicalState = canonicalState,
    expiresAt = expiresAt,
    inGraceUntil = inGraceUntil,
    subscriptionId = subscriptionId,
    latestEventTs = latestEventTs,
)
