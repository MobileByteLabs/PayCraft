package com.mobilebytelabs.paycraft.billing

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Contract tests for the Phase-2 purchase loop (PB-1, PB-2, PB-3, PB-7, SK-2, SK-3, SK-6).
 *
 * These pin the SHAPE of the contract the store adapters must honour — the parts that are
 * platform-independent and therefore testable without Play or StoreKit:
 *
 *  - a pending purchase is its own outcome, never a failure and never an entitlement;
 *  - identity reaches the store on every purchase;
 *  - the store is told a purchase is finished ONLY after the caller says so;
 *  - out-of-band purchases have a delivery path that exists whether or not anyone is purchasing.
 *
 * The Play/StoreKit adapters are exercised on-device; what regresses silently is the contract, and
 * that is what these hold.
 */
class PurchaseLoopTest {

    // ── A recording double that behaves like a real store adapter ─────────────

    private class RecordingBillingClient(private val outcome: (String) -> NativePurchaseResult) : NativeBillingClient {
        val purchasedWithIdentity = mutableListOf<Pair<String, String?>>()
        val finished = mutableListOf<NativePurchase>()
        var queryResult: List<NativePurchase> = emptyList()

        private val updates = MutableSharedFlow<NativePurchase>(extraBufferCapacity = 8)
        override val purchaseUpdates: Flow<NativePurchase> = updates.asSharedFlow()

        suspend fun emitOutOfBand(purchase: NativePurchase) = updates.emit(purchase)

        override suspend fun purchase(
            productId: String,
            appUserId: String?,
            productType: NativeProductType,
        ): NativePurchaseResult {
            purchasedWithIdentity += productId to appUserId
            return outcome(productId)
        }

        override suspend fun finishPurchase(purchase: NativePurchase) {
            finished += purchase
        }

        override suspend fun queryPurchases(): List<NativePurchase> = queryResult
        override suspend fun sync() = Unit
        override suspend fun restore(): List<NativePurchase> = queryResult
        override suspend fun manageSubscription(productId: String?) = Unit
        override suspend fun storefrontCountry(): String? = null
        override suspend fun nativeDisplayPrice(
            productId: String,
            productType: NativeProductType,
        ): NativeDisplayPrice? = null
    }

    private fun purchase(
        productId: String = "premium_monthly",
        pending: Boolean = false,
        acknowledged: Boolean = true,
    ) = NativePurchase(
        productId = productId,
        purchaseToken = "token_$productId",
        originalTransactionId = "order_1",
        purchaseTimeMillis = 1_700_000_000_000L,
        isAutoRenewing = true,
        isPending = pending,
        isAcknowledged = acknowledged,
    )

    // ── PB-1 / SK-7: identity reaches the store ───────────────────────────────

    @Test
    fun purchase_carriesAppUserIdToTheStore() = runTest {
        val client = RecordingBillingClient { NativePurchaseResult.Success(purchase()) }

        client.purchase("premium_monthly", "buyer@example.com")

        assertEquals(
            "premium_monthly" to "buyer@example.com",
            client.purchasedWithIdentity.single(),
            "The buyer identity must reach the store, or the server cannot bind the receipt to " +
                "an app user — which is what cross-device restore and fraud checks rest on.",
        )
    }

    // ── PB-3 / SK-6: pending is a first-class outcome ─────────────────────────

    @Test
    fun pendingPurchase_isNeitherSuccessNorFailure() = runTest {
        val pending = purchase(pending = true, acknowledged = false)
        val client = RecordingBillingClient { NativePurchaseResult.Pending(pending) }

        val result = client.purchase("premium_monthly", "buyer@example.com")

        assertTrue(
            result is NativePurchaseResult.Pending,
            "Cash/UPI and Ask-to-Buy purchases must surface as Pending. Reporting them as Failed " +
                "tells a buyer their payment bounced while the money is still in flight.",
        )
        assertTrue((result as NativePurchaseResult.Pending).purchase.isPending)
        assertFalse(
            result.purchase.isAcknowledged,
            "A pending purchase is not acknowledged — there is nothing to acknowledge yet.",
        )
    }

    @Test
    fun pendingPurchase_isNotFinishedWithTheStore() = runTest {
        val pending = purchase(pending = true, acknowledged = false)
        val client = RecordingBillingClient { NativePurchaseResult.Pending(pending) }

        client.purchase("premium_monthly", null)

        assertTrue(
            client.finished.isEmpty(),
            "Nothing may be finished/acknowledged while payment is still clearing.",
        )
    }

    // ── PB-7 / SK-3: finish happens on the caller's schedule, not the store's ─

    @Test
    fun purchase_doesNotFinishItself() = runTest {
        val client = RecordingBillingClient { NativePurchaseResult.Success(purchase()) }

        client.purchase("premium_monthly", "buyer@example.com")

        assertTrue(
            client.finished.isEmpty(),
            "purchase() must NOT finish the transaction. Finishing before the server records the " +
                "entitlement drops it from the store's unfinished queue — a failed server call " +
                "then leaves a paying customer with nothing to retry against.",
        )
    }

    @Test
    fun finishPurchase_isExplicitAndIdempotent() = runTest {
        val client = RecordingBillingClient { NativePurchaseResult.Success(purchase()) }
        val bought = purchase()

        client.finishPurchase(bought)
        client.finishPurchase(bought)

        assertEquals(2, client.finished.size, "finishPurchase must be safe to call more than once.")
        assertEquals(bought, client.finished.first())
    }

    // ── PB-7: unacknowledged purchases stay discoverable for retry ────────────

    @Test
    fun queryPurchases_surfacesUnacknowledgedPurchasesForRetry() = runTest {
        val client = RecordingBillingClient { NativePurchaseResult.Cancelled }
        client.queryResult = listOf(
            purchase("premium_monthly", acknowledged = false),
            purchase("premium_annual", acknowledged = true),
        )

        val needingRetry = client.queryPurchases().filter { !it.isAcknowledged && !it.isPending }

        assertEquals(
            listOf("premium_monthly"),
            needingRetry.map { it.productId },
            "An unacknowledged purchase must remain visible so the reconcile loop can retry it — " +
                "Play auto-refunds anything left unacknowledged for 72 hours.",
        )
    }

    // ── PB-2 / SK-2: out-of-band purchases have a delivery path ───────────────

    @Test
    fun outOfBandPurchase_reachesCollectorsWithNoPurchaseInFlight() = runTest {
        val client = RecordingBillingClient { NativePurchaseResult.Cancelled }
        val seen = mutableListOf<NativePurchase>()

        val job = launch { client.purchaseUpdates.collect { seen += it } }
        runCurrent()

        // A renewal / promo redemption / deferred payment clearing — nobody is calling purchase().
        client.emitOutOfBand(purchase("premium_annual"))
        runCurrent()
        job.cancel()

        assertEquals(
            listOf("premium_annual"),
            seen.map { it.productId },
            "Renewals, promo redemptions and deferred payments arrive with no purchase() awaiting " +
                "them. Before purchaseUpdates existed these were dropped and the buyer stayed " +
                "un-upgraded until some later manual refresh.",
        )
    }

    // ── The no-native-store platforms stay correct no-ops ─────────────────────

    @Test
    fun webCheckoutClient_hasNoUpdatesAndFinishesNothing() = runTest {
        val client = WebCheckoutNativeBillingClient()
        val seen = client.purchaseUpdates.toList()

        client.finishPurchase(purchase())

        assertTrue(seen.isEmpty(), "No native store → no store callbacks can ever arrive.")
        assertTrue(
            client.purchase("x", "buyer@example.com") is NativePurchaseResult.Failed,
            "Purchasing on a web-checkout platform must fail closed, never silently no-op.",
        )
    }
}
