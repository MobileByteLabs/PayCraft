package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.analytics.PayCraftAnalyticsListener
import com.mobilebytelabs.paycraft.billing.NativePurchaseResult
import com.mobilebytelabs.paycraft.config.StoreBinding
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.SpyNativeBillingClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A purchase cancelled or failed on the Play / App Store sheet is reported to PayCraft, because
 * neither store tells any server about it (no purchase exists). It becomes an "abandoned" /
 * "payment failed" row in the merchant's customer list — the store twin of an expired web checkout.
 */
class StoreAttemptReportTest {

    private class EmailStore(private val email: String?) : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = email
        override suspend fun clearEmail() = Unit
    }

    private fun plan(provider: String) = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$4",
        interval = "month",
        rank = 0,
        storeBinding = StoreBinding(provider, "premium_monthly"),
        isDigital = true,
    )

    private suspend fun FakePayCraftService.awaitAttempts(n: Int): List<List<String>> =
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                while (storeAttempts.size < n) delay(10)
                storeAttempts
            }
        }

    private fun manager(service: FakePayCraftService, native: SpyNativeBillingClient, email: String? = null) =
        PayCraftBillingManager(
            service = service,
            store = EmailStore(email),
            nativeBillingClient = native,
            dispatcher = Dispatchers.Default,
        )

    @Test
    fun closing_the_play_sheet_is_reported_as_abandoned() = runTest {
        val service = FakePayCraftService()
        manager(service, SpyNativeBillingClient()).purchaseViaPlayBilling(plan("google_play"), email = "buyer@x.test")
        assertEquals(
            listOf(listOf("google_play", "premium_monthly", "buyer@x.test", "abandoned")),
            service.awaitAttempts(1),
        )
    }

    @Test
    fun a_failed_app_store_payment_is_reported_as_payment_failed() = runTest {
        val service = FakePayCraftService()
        val native = SpyNativeBillingClient().apply { purchaseResult = NativePurchaseResult.Failed("declined") }
        manager(service, native).purchaseViaStoreKit(plan("app_store"), email = "buyer@x.test")
        assertEquals("app_store", service.awaitAttempts(1)[0][0])
        assertEquals("payment_failed", service.storeAttempts[0][3])
    }

    // 2026-11-17: 41 Reels Downloader Play failures reached the merchant with no cause. The store's reason code
    // now travels with the attempt; a cancel carries none.
    @Test
    fun a_failed_play_payment_carries_the_store_reason_code() = runTest {
        val service = FakePayCraftService()
        val native = SpyNativeBillingClient().apply {
            purchaseResult =
                NativePurchaseResult.Failed("Product not found on Play: x", "product_not_found")
        }
        manager(service, native).purchaseViaPlayBilling(plan("google_play"), email = "buyer@x.test")
        service.awaitAttempts(1)
        assertEquals(listOf<String?>("product_not_found"), service.storeAttemptReasons)
    }

    @AfterTest
    fun detachListener() {
        PayCraft.analyticsListener = null
    }

    // paycraft-attempt-observability D10 / AC-10: a store failure used to exist only in checkout_attempts. It now
    // ALSO reaches paywall_events as a structured failure, under the same attempt id the customer-list row carries.
    @Test
    fun a_failed_play_payment_reaches_paywall_events_as_a_provider_failure_under_its_attempt() = runTest {
        val seen = mutableListOf<Pair<String, Map<String, String>>>()
        PayCraft.analyticsListener = PayCraftAnalyticsListener { name, params -> seen += name to params }
        val service = FakePayCraftService()
        val native = SpyNativeBillingClient().apply {
            purchaseResult =
                NativePurchaseResult.Failed("Play billing connect failed: SERVICE_UNAVAILABLE", "connect_2")
        }
        manager(service, native).purchaseViaPlayBilling(plan("google_play"), email = "buyer@x.test")
        service.awaitAttempts(1)
        val fail = seen.single { it.first == "paycraft_purchase_fail" }.second
        assertEquals("provider", fail["stage"])
        assertEquals("store_connect", fail["error_class"])
        assertEquals("connect_2", fail["code"])
        assertEquals("google_play", fail["provider"])
        assertEquals(service.storeAttemptIds.single(), fail["attempt_id"], "one attempt id on both records")
        assertTrue(fail.values.none { it.contains("buyer@x.test") }, "no email in the event")
    }

    @Test
    fun a_cancelled_store_sheet_is_an_abandon_at_checkout_not_a_failure() = runTest {
        val seen = mutableListOf<Pair<String, Map<String, String>>>()
        PayCraft.analyticsListener = PayCraftAnalyticsListener { name, params -> seen += name to params }
        val service = FakePayCraftService()
        manager(service, SpyNativeBillingClient()).purchaseViaPlayBilling(plan("google_play"), email = "buyer@x.test")
        service.awaitAttempts(1)
        assertTrue(seen.none { it.first == "paycraft_purchase_fail" })
        val abandon = seen.single { it.first == "paycraft_step_abandon" }.second
        assertEquals("checkout", abandon["step"])
        assertEquals("store_cancelled", abandon["reason"])
        assertEquals(service.storeAttemptIds.single(), abandon["attempt_id"])
    }

    @Test
    fun store_codes_group_into_failure_classes() {
        val m = manager(FakePayCraftService(), SpyNativeBillingClient())
        assertEquals("store_connect", m.classifyStoreCode("connect_6"))
        assertEquals("store_purchase", m.classifyStoreCode("purchase_7"))
        assertEquals("store_launch", m.classifyStoreCode("launch_3"))
        assertEquals("catalog", m.classifyStoreCode("product_not_found"))
        assertEquals("catalog", m.classifyStoreCode("no_offer"))
        // The product lookup itself failed (Play down, network, billing unavailable) — not a catalogue problem.
        assertEquals("store_query", m.classifyStoreCode("query_2"))
        // The app was not installed by Google Play, which then cannot sell it anything (paycraft-ga4-analytics-audit AC-3).
        assertEquals("store_install", m.classifyStoreCode("not_from_play"))
        assertEquals("timeout", m.classifyStoreCode("timeout"))
        assertEquals("store_other", m.classifyStoreCode(null))
    }
}
