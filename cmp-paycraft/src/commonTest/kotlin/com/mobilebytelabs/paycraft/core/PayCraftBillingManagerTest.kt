package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.NativeDisplayPrice
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.billing.NativePurchaseResult
import com.mobilebytelabs.paycraft.config.StoreBinding
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Deterministic unit tests for [PayCraftBillingManager] — the device-conflict /
 * OAuth / premium state machine.
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
 * the transfer abort guard. (One path — a verified owner with
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

        var verifyOAuthBehavior: (suspend (OAuthProvider, String) -> String?) = { _, _ -> null }
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

        /** What the manager actually persisted — a refused identity must leave this untouched. */
        val savedEmail: String? get() = email

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
        override val purchaseUpdates: kotlinx.coroutines.flow.Flow<NativePurchase> =
            kotlinx.coroutines.flow.emptyFlow()
        override suspend fun purchase(
            productId: String,
            appUserId: String?,
            productType: com.mobilebytelabs.paycraft.billing.NativeProductType,
        ): NativePurchaseResult {
            purchaseCalled = true
            return NativePurchaseResult.Failed("not exercised in this test")
        }
        override suspend fun finishPurchase(purchase: NativePurchase) = Unit
        override suspend fun queryPurchases(): List<NativePurchase> = emptyList()
        override suspend fun sync() = Unit
        override suspend fun restore(): List<NativePurchase> = emptyList()
        override suspend fun manageSubscription(productId: String?) = Unit
        override suspend fun storefrontCountry(): String? = null
        override suspend fun nativeDisplayPrice(
            productId: String,
            productType: com.mobilebytelabs.paycraft.billing.NativeProductType,
        ): NativeDisplayPrice? = null
    }

    // Store ids now arrive as ONE server-resolved binding (provider + id) rather than a per-store
    // pair the client picks from. A null/blank id is still the anti-steering case: BLOCK, never web.
    private fun digitalPlan(provider: String = "google_play", productId: String? = "paycraft_monthly") = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$9.99",
        interval = "month",
        rank = 0,
        storeBinding = productId?.let { StoreBinding(provider, it) },
        isDigital = true,
    )

    // ─── Entitlement identity (the address a purchase is bound to) ─────────────

    /**
     * The address passed to `logIn` is not a display field: it is persisted, sent to the PSP as the
     * mandate's notify address, and echoed back on every webhook, where the purchase is routed by
     * it. Binding a value that cannot be an address attaches a paying customer's subscription to
     * something that reaches nobody, permanently and silently.
     */
    @Test
    fun logIn_malformedAddress_isRefusedAndNeverPersisted() {
        val store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null)
        val manager = PayCraftBillingManager(service = FakePayCraftService(), store = store)

        for (bad in listOf("", "   ", "not-an-email", "@example.com", "user@", "user@example", "a b@c.com")) {
            manager.logIn(bad)
        }

        assertNull(store.savedEmail, "a malformed identity must never be persisted")
        assertNull(manager.userEmail.value, "and must never become the live identity")
    }

    /**
     * Deliberately permissive on the accept side: plus-tags, long TLDs and subdomains all deliver,
     * and refusing a paying customer's real address is worse than accepting an odd-looking one.
     */
    @Test
    fun logIn_realWorldAddresses_areAccepted() {
        for (good in listOf("user@example.com", "user+tag@example.co.uk", "first.last@mail.example.io")) {
            val store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null)
            val manager = PayCraftBillingManager(service = FakePayCraftService(), store = store)
            manager.logIn(good)
            assertEquals(good, manager.userEmail.value, "'$good' is a deliverable address")
        }
    }

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
        manager.purchaseViaPlayBilling(
            digitalPlan(provider = "google_play", productId = null),
            email = "user@example.com",
        )

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

        manager.purchaseViaPlayBilling(digitalPlan(provider = "google_play", productId = "   "), email = null)

        assertIs<BillingState.Error>(manager.billingState.value)
        assertFalse(native.purchaseCalled)
    }

    // ── init must not clobber a state a caller already resolved ──────────────────────────────────
    //
    // The `init` block resolves entitlement ASYNCHRONOUSLY: with no saved email it settles on
    // BillingState.Free. Anything the user does during that window races it, and the write used to
    // be unconditional — so a resolved Error could be silently replaced by Free.
    //
    // This is a product defect, not a test artifact. On a cold start with no saved email, a buyer who
    // taps Subscribe on a misconfigured product sees the error appear and then VANISH a moment later,
    // with the paywall back to its normal free state and nothing explaining why.
    //
    // It surfaced as an intermittent failure of `purchaseViaPlayBilling_blankPlayProductId_isBlocked`
    // (expected Error, actual Free) — once in a full-suite run, never in isolation, because on
    // Dispatchers.Default the interleaving is the scheduler's choice. The injected dispatcher makes
    // the losing order the ONLY order, so the guard is tested rather than hoped for.

    @Test
    fun init_doesNotOverwriteAnErrorResolvedBeforeItRuns() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
            dispatcher = dispatcher,
        )

        // The init coroutine is QUEUED on the test dispatcher and has not run yet — the same window a
        // real cold start opens.
        manager.purchaseViaPlayBilling(digitalPlan(provider = "google_play", productId = "   "), email = null)
        assertIs<BillingState.Error>(
            manager.billingState.value,
            "the blank-productId guard is synchronous, so Error must be set immediately",
        )

        // Now let init finish. Before the fix its unconditional `_billingState.value = Free` landed
        // here and wiped the Error.
        advanceUntilIdle()

        assertIs<BillingState.Error>(
            manager.billingState.value,
            "init resolved Free over an Error the caller had already resolved — the error a buyer " +
                "needs to see would disappear on its own",
        )
        assertFalse(native.purchaseCalled, "must not launch the store flow for a misconfigured product")
    }

    @Test
    fun init_stillResolvesFreeWhenNothingElseHasHappened() = runTest {
        // The other half of the guard: it must not make init inert. With no cache, no email and no
        // caller action, Loading → Free is exactly what should happen.
        val dispatcher = StandardTestDispatcher(testScheduler)
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            dispatcher = dispatcher,
        )

        assertIs<BillingState.Loading>(manager.billingState.value, "starts unresolved")
        advanceUntilIdle()
        assertIs<BillingState.Free>(manager.billingState.value, "no email → Free")
    }

    // ── refreshStatus must not clear an Error it did not disprove ────────────────────────────────
    //
    // `refreshStatus` with no email takes a branch that makes NO server call — it just asserts Free
    // because there is no identity to look up. That is a fine way to RESOLVE an unresolved state,
    // but it is not authoritative enough to erase an Error a specific user action produced, because
    // nothing was actually checked.
    //
    // The user-visible shape is the same as the init clobber: a buyer hits a checkout error, the app
    // is foregrounded (or a TTL refresh fires), and the error disappears with the paywall back to
    // normal and no explanation.

    @Test
    fun refreshStatus_doesNotClearAnError_whenThereIsNoEmailToCheck() {
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )

        // Synchronous guard → Error, with no email ever set.
        manager.purchaseViaPlayBilling(digitalPlan(provider = "google_play", productId = "   "), email = null)
        assertIs<BillingState.Error>(manager.billingState.value)

        manager.refreshStatus()

        assertIs<BillingState.Error>(
            manager.billingState.value,
            "refreshStatus made no server call (no email) yet replaced the Error with Free — " +
                "clearing an error it never disproved",
        )
    }

    @Test
    fun refreshStatus_forced_doesNotClearAnError_either() {
        // force=true is for realtime entitlement pushes. Even so, the no-email branch still checks
        // nothing, so it must not be the thing that silences an error.
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )
        manager.purchaseViaPlayBilling(digitalPlan(provider = "google_play", productId = "   "), email = null)

        manager.refreshStatus(force = true)

        assertIs<BillingState.Error>(manager.billingState.value)
    }

    @Test
    fun refreshStatus_forced_fromLoading_withNoEmail_stillResolvesFree() {
        // The behaviour that must NOT regress (audit H5 + the no-identity resolution): a FORCED
        // refresh is allowed through the Loading window, and with no email it settles on Free.
        // Only `Error` is newly protected; the force/Loading interaction is untouched.
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
        )
        assertIs<BillingState.Loading>(manager.billingState.value, "starts unresolved")

        manager.refreshStatus(force = true)

        assertIs<BillingState.Free>(manager.billingState.value, "no identity → Free")
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

        manager.purchaseViaPlayBilling(
            digitalPlan(provider = "google_play", productId = "paycraft_monthly"),
            email = null,
        )

        assertIs<BillingState.Error>(manager.billingState.value)
    }

    // ─── Apple StoreKit anti-steering guard (Guideline 3.1.1 keystone) ─────────

    @Test
    fun purchaseViaStoreKit_missingAppStoreProductId_setsErrorAndNeverLaunchesPurchase() {
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )

        // A digital product with NO app_store_product_id must be BLOCKED — not routed to the store,
        // and (by the caller contract) not to the browser either (Apple 3.1.1 anti-steering).
        manager.purchaseViaStoreKit(digitalPlan(provider = "app_store", productId = null), email = "user@example.com")

        val state = assertIs<BillingState.Error>(manager.billingState.value)
        assertEquals("App Store product not configured", state.message)
        assertFalse(native.purchaseCalled, "must not launch the store flow for a misconfigured product")
    }

    @Test
    fun purchaseViaStoreKit_blankAppStoreProductId_isBlocked() {
        val native = FakeNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = native,
        )

        manager.purchaseViaStoreKit(digitalPlan(provider = "app_store", productId = "   "), email = null)

        assertIs<BillingState.Error>(manager.billingState.value)
        assertFalse(native.purchaseCalled)
    }

    @Test
    fun purchaseViaStoreKit_noNativeClientWired_failsClosedWithError() {
        // No NativeBillingClient (StoreKit module not loaded) → fail closed with an error,
        // NEVER a silent web fallback.
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = FakePayCraftStore(cached = null, lastSynced = 0L, email = null),
            nativeBillingClient = null,
        )

        manager.purchaseViaStoreKit(
            digitalPlan(provider = "app_store", productId = "com.paycraft.monthly"),
            email = null,
        )

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
