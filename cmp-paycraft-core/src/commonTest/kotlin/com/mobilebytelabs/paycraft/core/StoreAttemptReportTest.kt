package com.mobilebytelabs.paycraft.core

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
import kotlin.test.Test
import kotlin.test.assertEquals

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
}
