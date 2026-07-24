package com.mobilebytelabs.paycraft.canary.restore.green

import com.mobilebytelabs.paycraft.canary.restore.red.RestoreCrossPlatformRedFixture
import com.mobilebytelabs.paycraft.core.EntitlementRepository
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.InMemoryEntitlementDao
import com.mobilebytelabs.paycraft.testsupport.SpyNativeBillingClient
import com.mobilebytelabs.paycraft.testsupport.entitlementDto
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours

/**
 * GREEN canary (AC5): a subscription bought on iOS restores as ACTIVE on Android because restore
 * is keyed by the STABLE app-user-id (not the store account), and the native store restore path
 * (`AppStore.sync()` / `queryPurchasesAsync()`) is exercised before the server reconcile.
 *
 * The RED fixture ([RestoreCrossPlatformRedFixture]) keys by store account — the second platform,
 * on a different store account (appUserId ≠ store-account), reconciles against a key the server
 * never saw and loses the entitlement.
 */
class RestoreCrossPlatformCanaryTest {

    private val expiresAtMs = 1_900_000_000_000L

    /** Fresh "device": its own SoT + native client, all pointing at the one server [service]. */
    private fun deviceRepo(service: FakePayCraftService, native: SpyNativeBillingClient) = EntitlementRepository(
        cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
        native = native,
        service = service,
    )

    @Test
    fun restore_by_app_user_id_active_on_second_platform() = runTest {
        // ONE canonical server record, keyed by the stable app-user-id — bought on iOS.
        val service = FakePayCraftService(networkUp = true)
        service.seed(
            entitlementDto(
                appUserId = "user-42",
                provider = "app_store",
                canonicalState = "active",
                expiresAt = expiresAtMs,
            ),
        )

        // iOS device restore — AppStore.sync() path.
        val iosNative = SpyNativeBillingClient()
        val iosEntitlement = deviceRepo(service, iosNative).restore("user-42")
        assertEquals(SubscriptionState.Active, iosEntitlement.canonicalState)
        assertTrue(iosNative.syncCalls >= 1, "AppStore.sync()/queryPurchasesAsync() must run on restore")
        assertTrue(iosNative.restoreCalls >= 1)

        // Android device — DIFFERENT store account, SAME stable app-user-id → same canonical record.
        val androidNative = SpyNativeBillingClient()
        val androidRepo = deviceRepo(service, androidNative)
        val androidEntitlement = androidRepo.restore("user-42")
        assertEquals(
            SubscriptionState.Active,
            androidEntitlement.canonicalState,
            "stable app-user-id → entitlement is active on the SECOND platform",
        )

        // RED: restoring by the per-platform STORE ACCOUNT key loses the entitlement (server never
        // saw that key) — the fetcher errors and no canonical record is produced.
        assertFailsWith<Throwable> {
            androidRepo.restore(RestoreCrossPlatformRedFixture.keyForRestore("store-acct-android"))
        }
    }
}
