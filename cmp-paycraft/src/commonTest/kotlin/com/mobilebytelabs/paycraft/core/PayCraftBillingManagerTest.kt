package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.billing.NativePurchaseResult
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.OtpGateResult
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Deterministic unit tests for [PayCraftBillingManager] — the device-conflict /
 * OTP / OAuth / premium state machine.
 *
 * Scope note (why this is a subset of the class): the manager reaches for three
 * platform singletons that are `expect object`s and therefore cannot be injected —
 * [com.mobilebytelabs.paycraft.platform.DeviceTokenStore],
 * [com.mobilebytelabs.paycraft.platform.PlatformInfo], and the [com.mobilebytelabs.paycraft.PayCraft]
 * config object. Any code path that reads/writes the device token (register →
 * conflict → OwnershipVerified → transfer/revoke, and the server-driven
 * `applyPremiumResult` premium branch) depends on that filesystem/Keychain-backed
 * singleton and cannot be exercised deterministically from `commonTest` (the JVM
 * actual writes `~/.paycraft/device_token`; native/JS actuals differ). These tests
 * therefore cover the state transitions that do not DEPEND on device-token state:
 * cache-driven premium application, logout reset, the OAuth error transitions, the
 * OTP verification gate, and the transfer abort guard. (One path — a correct OTP with
 * no active conflict — performs a single read-only `DeviceTokenStore.getToken()`, but
 * its return value cannot affect the assertion: the transition it guards requires a
 * non-null conflict.) The write-driven token paths (register → conflict →
 * OwnershipVerified → transfer/revoke, and the server-driven `applyPremiumResult`
 * premium branch) are left to on-device / instrumented coverage.
 *
 * Both [PayCraftService] (network/RPC) and [PayCraftStore] (cache) are faked.
 */
class PayCraftBillingManagerTest {

    // ─── Fakes ──────────────────────────────────────────────────────────────

    /**
     * Fully controllable fake of the RPC surface. Each method delegates to a
     * mutable lambda so a test can inject success, failure (throw), or a specific
     * return value, and can assert whether a method was invoked.
     */
    private class FakePayCraftService : PayCraftService {
        var transferCalled = false
        var revokeCalled = false
        var getSubscriptionCalled = false

        var verifyOtpBehavior: (suspend (String, String) -> Boolean) = { _, _ -> false }
        var verifyOAuthBehavior: (suspend (OAuthProvider, String) -> String?) = { _, _ -> null }
        var sendOtpBehavior: (suspend (String) -> Unit) = { }
        var getSubscriptionBehavior: (suspend (String) -> SubscriptionDto?) = { null }

        override suspend fun isPremium(serverToken: String): Boolean = false

        override suspend fun getSubscription(serverToken: String): SubscriptionDto? {
            getSubscriptionCalled = true
            return getSubscriptionBehavior(serverToken)
        }

        override suspend fun isTrialEligible(serverToken: String): Boolean = true

        override suspend fun registerDevice(
            email: String,
            platform: String,
            deviceName: String,
            deviceId: String,
            mode: String,
        ): RegisterDeviceResult = RegisterDeviceResult(
            deviceToken = "tok",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )

        override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult =
            PremiumCheckResult(isPremium = false, tokenValid = true)

        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean {
            transferCalled = true
            return true
        }

        override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean {
            revokeCalled = true
            return true
        }

        override suspend fun checkOtpGate(): OtpGateResult = OtpGateResult(false, 0, 300)

        override suspend fun sendOtp(email: String) = sendOtpBehavior(email)

        override suspend fun verifyOtp(email: String, token: String): Boolean = verifyOtpBehavior(email, token)

        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? =
            verifyOAuthBehavior(provider, idToken)
    }

    /** In-memory [PayCraftStore] with configurable cache + email seed. */
    private class FakePayCraftStore(
        private var cached: SubscriptionStatus? = null,
        private var lastSynced: Long = 0L,
        private var email: String? = null,
    ) : PayCraftStore {
        var clearCacheCalled = false

        override suspend fun saveEmail(email: String) {
            this.email = email
        }
        override suspend fun getEmail(): String? = email
        override suspend fun clearEmail() {
            email = null
        }

        override fun cacheSubscriptionStatus(status: SubscriptionStatus) {
            cached = status
        }
        override fun getCachedSubscriptionStatus(): SubscriptionStatus? = cached
        override fun getLastSyncedAt(): Long = lastSynced
        override fun clearCache() {
            clearCacheCalled = true
            cached = null
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * A cached premium status whose expiry is far in the future with auto-renew on,
     * so [SyncPolicy.syncInterval] resolves to weekly. Paired with `lastSynced = now`
     * this makes [SyncPolicy.isSyncDue] return false, so the manager's async init
     * block hits the "cache fresh → skip network" branch and never mutates
     * [BillingState]. That gives the tests a stable, deterministic starting state.
     */
    private fun freshPremiumCache() = SubscriptionStatus(
        isPremium = true,
        plan = "annual",
        email = "user@example.com",
        provider = "stripe",
        expiresAt = "2999-01-01T00:00:00Z",
        willRenew = true,
    )

    /** Manager seeded with a fresh premium cache — starts settled in [BillingState.Premium]. */
    private fun managerWithFreshPremiumCache(service: FakePayCraftService): PayCraftBillingManager =
        PayCraftBillingManager(
            service = service,
            store = FakePayCraftStore(
                cached = freshPremiumCache(),
                lastSynced = currentTimeMillis(),
                email = "user@example.com",
            ),
        )

    /**
     * Records whether the native store purchase flow was launched, so the anti-steering tests can
     * prove the browser/native flow is NEVER reached when the product is misconfigured.
     */
    private class FakeNativeBillingClient : NativeBillingClient {
        var purchaseCalled = false
        override suspend fun purchase(productId: String): NativePurchaseResult {
            purchaseCalled = true
            return NativePurchaseResult.Failed("not exercised in this test")
        }
        override suspend fun queryPurchases(): List<NativePurchase> = emptyList()
        override suspend fun sync() = Unit
        override suspend fun restore(): List<NativePurchase> = emptyList()
        override suspend fun manageSubscription(productId: String?) = Unit
    }

    private fun digitalPlan(playProductId: String?) = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$9.99",
        interval = "month",
        rank = 0,
        playProductId = playProductId,
        isDigital = true,
    )

    // ─── Google Play Billing anti-steering guard (Payments-policy keystone) ────

    @Test
    fun purchaseViaPlayBilling_missingPlayProductId_setsErrorAndNeverLaunchesPurchase() {
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )

        // A digital product with NO play_product_id must be BLOCKED — not routed to the store, and
        // (by the caller contract) not to the browser either.
        manager.purchaseViaPlayBilling(digitalPlan(playProductId = null), email = "user@example.com")

        val state = assertIs<BillingState.Error>(manager.billingState.value)
        assertEquals("Google Play product not configured", state.message)
        assertFalse(native.purchaseCalled, "must not launch the store flow for a misconfigured product")
    }

    @Test
    fun purchaseViaPlayBilling_blankPlayProductId_isBlocked() {
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )

        manager.purchaseViaPlayBilling(digitalPlan(playProductId = "   "), email = null)

        assertIs<BillingState.Error>(manager.billingState.value)
        assertFalse(native.purchaseCalled)
    }

    @Test
    fun purchaseViaPlayBilling_noNativeClientWired_failsClosedWithError() {
        // No NativeBillingClient (paycraftPlayBillingModule not loaded) → fail closed with an error,
        // NEVER a silent web fallback.
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = null,
        )

        manager.purchaseViaPlayBilling(digitalPlan(playProductId = "paycraft_monthly"), email = null)

        assertIs<BillingState.Error>(manager.billingState.value)
    }

    // ─── Cache-driven premium application (applyCachedStatus) ──────────────────

    @Test
    fun init_withCachedPremiumStatus_appliesPremiumStateSynchronously() {
        val cached = freshPremiumCache()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = cached, lastSynced = currentTimeMillis(), email = cached.email),
        )

        assertTrue(manager.isPremium.value)
        assertEquals(cached, manager.subscriptionStatus.value)
        val state = assertIs<BillingState.Premium>(manager.billingState.value)
        assertEquals(cached, state.status)
        // Trial state is not persisted in the cache — conservative defaults until refresh.
        assertFalse(manager.isInTrial.value)
        assertNull(manager.trialEndsAt.value)
    }

    @Test
    fun init_withCachedFreeStatus_appliesFreeState() {
        val cached = SubscriptionStatus(isPremium = false, email = "user@example.com")
        // Free status → daily interval; synced now → not due → async init won't overwrite.
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = cached, lastSynced = currentTimeMillis(), email = cached.email),
        )

        assertFalse(manager.isPremium.value)
        assertEquals(BillingState.Free, manager.billingState.value)
    }

    // ─── Logout reset transition ───────────────────────────────────────────────

    @Test
    fun logOut_resetsAllStateToFree() {
        // No cache + no email → the async init block settles to Free without ever
        // writing userEmail, so the only writer of userEmail is logOut() itself.
        val store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null)
        val manager = PayCraftBillingManager(service = FakePayCraftService(), store = store)

        manager.logOut()

        assertFalse(manager.isPremium.value)
        assertFalse(manager.isInTrial.value)
        assertNull(manager.trialEndsAt.value)
        assertNull(manager.userEmail.value)
        assertEquals(SubscriptionStatus(), manager.subscriptionStatus.value)
        assertEquals(BillingState.Free, manager.billingState.value)
        assertTrue(store.clearCacheCalled)
    }

    // ─── OAuth error transitions (Gate 1) ──────────────────────────────────────

    @Test
    fun loginWithOAuth_serviceThrows_setsErrorStateWithMessage() = runTest {
        val service = FakePayCraftService().apply {
            verifyOAuthBehavior = { _, _ -> throw RuntimeException("network down") }
        }
        val manager = managerWithFreshPremiumCache(service)

        manager.loginWithOAuth(OAuthProvider.GOOGLE, "id-token")

        val state = assertIs<BillingState.Error>(manager.billingState.value)
        assertEquals("network down", state.message)
    }

    @Test
    fun loginWithOAuth_serviceReturnsNull_setsIdentityError() = runTest {
        val service = FakePayCraftService().apply {
            verifyOAuthBehavior = { _, _ -> null }
        }
        val manager = managerWithFreshPremiumCache(service)

        manager.loginWithOAuth(OAuthProvider.APPLE, "id-token")

        val state = assertIs<BillingState.Error>(manager.billingState.value)
        assertEquals("Could not verify your identity. Please try again.", state.message)
    }

    // ─── OTP verification gate (Gate 2) ─────────────────────────────────────────

    @Test
    fun verifyOtp_serviceSucceeds_returnsTrue() = runTest {
        val service = FakePayCraftService().apply { verifyOtpBehavior = { _, _ -> true } }
        val manager = managerWithFreshPremiumCache(service)

        assertTrue(manager.verifyOtp("user@example.com", "123456"))
    }

    @Test
    fun verifyOtp_serviceThrows_returnsFalse() = runTest {
        val service = FakePayCraftService().apply {
            verifyOtpBehavior = { _, _ -> throw RuntimeException("bad otp") }
        }
        val manager = managerWithFreshPremiumCache(service)

        assertFalse(manager.verifyOtp("user@example.com", "000000"))
    }

    @Test
    fun verifyOtpOwnership_noActiveConflict_returnsResultWithoutStateTransition() = runTest {
        // With no cached conflict, a correct OTP must NOT flip the state to
        // OwnershipVerified — that transition requires an active DeviceConflict.
        val service = FakePayCraftService().apply { verifyOtpBehavior = { _, _ -> true } }
        val manager = managerWithFreshPremiumCache(service)

        val ok = manager.verifyOtpOwnership("user@example.com", "123456")

        assertTrue(ok)
        assertTrue(
            manager.billingState.value is BillingState.Premium,
            "state must not transition to OwnershipVerified without an active conflict",
        )
    }

    @Test
    fun verifyOtpOwnership_serviceThrows_returnsFalse() = runTest {
        val service = FakePayCraftService().apply {
            verifyOtpBehavior = { _, _ -> throw RuntimeException("rpc failure") }
        }
        val manager = managerWithFreshPremiumCache(service)

        assertFalse(manager.verifyOtpOwnership("user@example.com", "000000"))
    }

    @Test
    fun requestOtpVerification_serviceThrows_isSwallowed() = runTest {
        val service = FakePayCraftService().apply {
            sendOtpBehavior = { throw RuntimeException("send failed") }
        }
        val manager = managerWithFreshPremiumCache(service)

        // Must not propagate — the caller UI keeps working even if the send RPC fails.
        manager.requestOtpVerification("user@example.com")
    }

    // ─── Transfer abort guard ───────────────────────────────────────────────────

    @Test
    fun confirmDeviceTransfer_noOwnershipVerifiedState_isNoOp() = runTest {
        val service = FakePayCraftService()
        val manager = managerWithFreshPremiumCache(service)

        manager.confirmDeviceTransfer()

        // No OwnershipVerified state and no cached conflict → aborts before any RPC.
        assertFalse(service.transferCalled)
        assertTrue(
            manager.billingState.value is BillingState.Premium,
            "state must be unchanged when there is nothing to transfer",
        )
    }
}
