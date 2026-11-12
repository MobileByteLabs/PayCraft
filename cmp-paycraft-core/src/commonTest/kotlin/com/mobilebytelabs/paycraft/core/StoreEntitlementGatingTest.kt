package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.InMemoryEntitlementDao
import com.mobilebytelabs.paycraft.testsupport.SpyNativeBillingClient
import com.mobilebytelabs.paycraft.testsupport.entitlementDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours

/**
 * A STORE subscription must drive premium after the purchase moment.
 *
 * Device finding 2026-10-31 (cappy, Play test purchase): nothing read a store entitlement back.
 * Premium was set once from the purchase response, then every refresh replaced it — the email path
 * asks `check_premium_with_device`, which reads only web `subscriptions`, and the no-email path
 * resolved Free without asking anything. `observeEntitlement` / `onRestore` existed with no caller.
 * And no SDK restore UI ran a store restore at all: "Restore Purchases" only asked for an email.
 */
class StoreEntitlementGatingTest {

    private class NoEmailStore : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
    }

    private val token = "play-token-week"
    private val deviceId get() = PayCraft.deviceId

    private fun storePurchase() = NativePurchase(
        productId = "com.example.sub.week",
        purchaseToken = token,
        originalTransactionId = null,
        purchaseTimeMillis = 1_000L,
        isAutoRenewing = true,
        packageName = "com.example",
    )

    private fun activeStoreEntitlement(appUserId: String) = entitlementDto(
        appUserId = appUserId,
        provider = "google_play",
        canonicalState = "active",
        expiresAt = 4_000_000_000_000L,
        subscriptionId = token,
    )

    // Real dispatcher: Store5 reads on its own threads, so virtual-time advancing cannot settle init.
    private fun manager(service: FakePayCraftService, native: SpyNativeBillingClient) = PayCraftBillingManager(
        service = service,
        store = NoEmailStore(),
        repo = EntitlementRepository(
            cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
            native = native,
            service = service,
            platform = { "android" },
        ),
        nativeBillingClient = native,
        dispatcher = Dispatchers.Default,
    )

    /** Wait (real time, bounded) for init to resolve its first verdict. */
    private suspend fun PayCraftBillingManager.settled(): BillingState = withContext(Dispatchers.Default) {
        withTimeout(5_000) { billingState.first { it !is BillingState.Loading } }
    }

    @Test
    fun cold_start_without_email_reads_the_store_entitlement_instead_of_asserting_free() = runTest {
        val service = FakePayCraftService().apply { seed(activeStoreEntitlement(deviceId)) }
        val manager = manager(service, SpyNativeBillingClient())

        assertIs<BillingState.Premium>(manager.settled(), "an active store subscription is premium")
        assertTrue(manager.isPremium.value)
    }

    /**
     * Device finding 2026-11-08 (reels, Play test subscription): since migration 176 the server's
     * premium check answers TRUE for a store subscriber. The SDK then built the status from web
     * `subscriptions` only — empty for a store subscriber — and cached premium with NO expiry, so
     * SyncPolicy fell back to a daily check and the app showed Premium for ~a day after the
     * subscription expired. The store entitlement carries the real expiry; it must be used.
     */
    @Test
    fun server_premium_for_a_store_subscriber_caches_the_store_expiry() = runTest {
        val email = "buyer@test.local"
        val service = FakePayCraftService().apply {
            serverPremium = true
            seed(activeStoreEntitlement(email))
        }
        val emailStore = object : PayCraftStore {
            override suspend fun saveEmail(email: String) = Unit
            override suspend fun getEmail(): String? = email
            override suspend fun clearEmail() = Unit
        }
        val native = SpyNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = service,
            store = emailStore,
            repo = EntitlementRepository(
                cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
                native = native,
                service = service,
                platform = { "android" },
            ),
            nativeBillingClient = native,
            dispatcher = Dispatchers.Default,
        )

        assertIs<BillingState.Premium>(manager.settled())
        assertNotNull(
            manager.subscriptionStatus.value.expiresAt,
            "premium must carry the store expiry, or it outlives it",
        )
    }

    /**
     * Device finding 2026-11-08 (reels, Play test subscription revoked, user never signed in): init
     * applied the cached Premium (`isPremium = true`), the no-email path then set only
     * `billingState = Free` and left `isPremium` and the cache untouched. Settings read Free while
     * every `isPremium` gate (ads hidden, HD unlocked) stayed Premium — across relaunches.
     */
    @Test
    fun a_lapsed_store_subscription_clears_cached_premium_without_an_email() = runTest {
        val cache = object : PayCraftStore {
            var cached: SubscriptionStatus? = SubscriptionStatus(isPremium = true, provider = "google_play")
            override suspend fun saveEmail(email: String) = Unit
            override suspend fun getEmail(): String? = null
            override suspend fun clearEmail() = Unit
            override fun cacheSubscriptionStatus(status: SubscriptionStatus) {
                cached = status
            }
            override fun getCachedSubscriptionStatus(): SubscriptionStatus? = cached
        }
        val service = FakePayCraftService().apply {
            seed(activeStoreEntitlement(deviceId).copy(canonicalState = "expired", expiresAt = 1_000L))
        }
        val native = SpyNativeBillingClient()
        val manager = PayCraftBillingManager(
            service = service,
            store = cache,
            repo = EntitlementRepository(
                cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
                native = native,
                service = service,
                platform = { "android" },
            ),
            nativeBillingClient = native,
            dispatcher = Dispatchers.Default,
        )

        withContext(Dispatchers.Default) { withTimeout(5_000) { manager.isPremium.first { !it } } }
        assertIs<BillingState.Free>(manager.billingState.value)
        assertFalse(cache.cached!!.isPremium, "the cached Premium must be overwritten, or the next launch restores it")
    }

    /**
     * Device finding 2026-11-10 (reels on PayCraft 3.0.0, Play test purchase, user signed in): init
     * re-registered the unacknowledged purchase BEFORE the saved email had loaded, so it presented the
     * anonymous device id. The server refused (the transaction belongs to a signed-in account), the SDK
     * left it unfinished, and Play reported the purchase ACKNOWLEDGEMENT_STATE_PENDING — the state Play
     * auto-refunds after 72 hours. Every launch-time registration must wait for the saved identity.
     */
    @Test
    fun launch_registers_an_unfinished_purchase_as_the_saved_email_not_the_device() = runTest {
        val email = "buyer@test.local"
        val slowEmailStore = object : PayCraftStore {
            override suspend fun saveEmail(email: String) = Unit
            override suspend fun getEmail(): String? {
                kotlinx.coroutines.delay(300) // the saved identity arrives after init has started
                return email
            }
            override suspend fun clearEmail() = Unit
        }
        val service = FakePayCraftService().apply { storeTruth[token] = activeStoreEntitlement(email) }
        // Unacknowledged — the launch-time reconcile sweep is the path that presented the device id.
        val native = SpyNativeBillingClient().apply {
            storePurchases =
                listOf(storePurchase().copy(isAcknowledged = false))
        }
        PayCraftBillingManager(
            service = service,
            store = slowEmailStore,
            repo = EntitlementRepository(
                cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
                native = native,
                service = service,
                platform = { "android" },
            ),
            nativeBillingClient = native,
            dispatcher = Dispatchers.Default,
            platform = { "android" },
        )

        withContext(Dispatchers.Default) {
            withTimeout(5_000) { while (service.registered.isEmpty()) kotlinx.coroutines.delay(20) }
            kotlinx.coroutines.delay(300) // let any other launch-time registration land too
        }
        assertTrue(service.registered.isNotEmpty())
        assertTrue(
            service.registered.all { it.second == email },
            "every registration presents the signed-in email, never the device id: ${service.registered}",
        )
    }

    @Test
    fun cold_start_without_email_or_store_entitlement_is_still_free() = runTest {
        val manager = manager(FakePayCraftService(), SpyNativeBillingClient())

        assertIs<BillingState.Free>(manager.settled())
    }

    /**
     * The server learns a renewal / cancel only from a store notification (RTDN / ASSN). When that
     * channel is missing or late, the record goes stale while the store keeps billing. Every launch
     * therefore re-presents what the store holds — the server re-fetches truth from the store — so a
     * paying user is never left Free by a missed notification, and a reinstall needs no Restore tap.
     */
    @Test
    fun launch_resyncs_held_store_purchases_so_a_stale_server_record_cannot_leave_a_payer_free() = runTest {
        // The server has nothing current for this install; the store still holds an active purchase.
        val service = FakePayCraftService().apply { storeTruth[token] = activeStoreEntitlement("old-device") }
        val native = SpyNativeBillingClient().apply { storePurchases = listOf(storePurchase()) }

        val manager = manager(service, native)

        assertIs<BillingState.Premium>(manager.settled(), "launch must re-sync the store, not trust a stale record")
        assertTrue(service.registered.any { it.first == token }, "the held purchase was re-presented to the server")
    }

    /**
     * Device finding 2026-10-31: the server record was ACTIVE but the app logged "no active
     * subscription found" and made no network call. The premium read used Store5's cached-then-
     * refresh stream and took its FIRST value — the stale cache (an expired period) — so a renewal
     * the server already knew about never reached the gate.
     */
    @Test
    fun a_stale_cached_entitlement_does_not_mask_an_active_one_on_the_server() = runTest {
        val service = FakePayCraftService().apply {
            seed(activeStoreEntitlement(deviceId).copy(canonicalState = "expired", expiresAt = 1_000L))
        }
        val manager = manager(service, SpyNativeBillingClient())
        assertIs<BillingState.Free>(manager.settled(), "precondition: the cache now holds the expired period")

        service.seed(activeStoreEntitlement(deviceId)) // the store renewed; the server knows
        manager.refreshStatus(force = true)

        val state = withContext(Dispatchers.Default) {
            withTimeout(5_000) { manager.billingState.first { it is BillingState.Premium } }
        }
        assertIs<BillingState.Premium>(state)
    }

    /**
     * Google's integration guide: call queryPurchasesAsync() "in your app's onResume() method to
     * handle purchases that have transitioned to the PURCHASED state while your app was not running".
     * The SDK only synced at process start, so an app left in the background (process alive) never
     * re-checked — a pending payment that cleared, or a renewal, waited for the next cold start.
     */
    @Test
    fun returning_to_the_foreground_resyncs_what_the_store_holds() = runTest {
        val service = FakePayCraftService().apply { storeTruth[token] = activeStoreEntitlement("old-device") }
        val native = SpyNativeBillingClient() // nothing held at launch …
        val manager = manager(service, native)
        assertIs<BillingState.Free>(manager.settled())

        native.storePurchases = listOf(storePurchase()) // … a pending payment cleared while backgrounded
        manager.onAppForegrounded()

        val state = withContext(Dispatchers.Default) {
            withTimeout(5_000) { manager.billingState.first { it is BillingState.Premium } }
        }
        assertIs<BillingState.Premium>(state)
    }

    @Test
    fun restore_store_purchases_rebinds_and_unlocks_without_any_email() = runTest {
        // Bought under an earlier install's id; this install has a different one and no email.
        val service = FakePayCraftService().apply { storeTruth[token] = activeStoreEntitlement("old-device") }
        // The store returns nothing at launch (e.g. Play's purchase cache was cold) …
        val native = SpyNativeBillingClient()
        val manager = manager(service, native)
        assertIs<BillingState.Free>(manager.settled())
        // … and the purchase only surfaces when the user explicitly asks the store to restore.
        native.storePurchases = listOf(storePurchase())

        val restored = manager.restoreStorePurchases()

        assertTrue(restored, "the store held an active subscription — restore must report it")
        assertIs<BillingState.Premium>(manager.billingState.value)
    }
}
