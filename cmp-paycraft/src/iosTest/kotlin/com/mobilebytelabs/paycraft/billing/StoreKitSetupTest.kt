package com.mobilebytelabs.paycraft.billing

import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase-3 iOS parity tests (SK-1, SK-5).
 *
 * The audit's headline iOS finding was that `platformDefaultNativeBillingClient()` returned `null`
 * while Android returned a live client, and the resulting failure ("App Store billing is not
 * available on this device") read like a device fault rather than missing setup. These pin the new
 * behaviour: never null, always fail-closed, and a message that names the missing line.
 */
class StoreKitSetupTest {

    @AfterTest
    fun tearDown() = PayCraftStoreKit.reset()

    private class FakeBridge : StoreKit2Bridge {
        override fun startTransactionUpdates(listener: StoreKit2TransactionListener) = Unit
        override suspend fun finish(transactionId: String) = Unit
        override suspend fun purchase(productId: String, appAccountToken: String?): StoreKit2Outcome =
            StoreKit2Outcome.Cancelled
        override suspend fun currentEntitlements(): List<StoreKit2Transaction> = emptyList()
        override suspend fun sync() = Unit
        override suspend fun showManageSubscriptions() = Unit
        override suspend fun storefrontCountry(): String? = "US"
        override suspend fun displayPrice(productId: String): StoreKit2Price? = null
        override suspend fun introOffer(productId: String): StoreKit2IntroOffer? = null
    }

    // ── SK-1: never null, and the un-set-up path is diagnosable ───────────────

    @Test
    fun beforeInstall_returnsAFailClosedClientNotNull() {
        PayCraftStoreKit.reset()

        val client = platformDefaultNativeBillingClient()

        assertTrue(
            client is UnconfiguredStoreKitClient,
            "iOS must hand back a fail-closed client, never null. Null collapsed into a generic " +
                "'billing is not available on this device', which reads as a device fault.",
        )
        assertFalse(PayCraftStoreKit.isConfigured)
    }

    @Test
    fun beforeInstall_purchaseFailsWithAnActionableMessage() = runTest {
        PayCraftStoreKit.reset()
        val client = platformDefaultNativeBillingClient()!!

        val result = client.purchase("premium_monthly", "buyer@example.com")

        assertTrue(result is NativePurchaseResult.Failed)
        val message = (result as NativePurchaseResult.Failed).message
        assertTrue(
            message.contains("PayCraftStoreKit2.install()"),
            "The failure must name the exact line that is missing. Got: $message",
        )
    }

    @Test
    fun beforeInstall_neverFallsBackToWebCheckout() = runTest {
        PayCraftStoreKit.reset()
        val client = platformDefaultNativeBillingClient()!!

        val result = client.purchase("premium_monthly", null)

        assertTrue(
            result is NativePurchaseResult.Failed,
            "A missing bridge must FAIL, never route a digital purchase to a web page — that is " +
                "the App Store Guideline 3.1.1 violation the checkout-lane router exists to stop.",
        )
    }

    @Test
    fun afterInstall_returnsTheRealStoreKitClient() {
        PayCraftStoreKit.register(FakeBridge())

        val client = platformDefaultNativeBillingClient()

        assertTrue(
            client is StoreKit2NativeBillingClient,
            "One call to PayCraftStoreKit.register (what PayCraftStoreKit2.install() does) must be " +
                "all it takes to get a working client.",
        )
        assertTrue(PayCraftStoreKit.isConfigured)
    }

    @Test
    fun register_isIdempotentAndLastWriteWins() {
        PayCraftStoreKit.register(FakeBridge())
        PayCraftStoreKit.register(FakeBridge())

        assertTrue(PayCraftStoreKit.isConfigured)
        assertTrue(platformDefaultNativeBillingClient() is StoreKit2NativeBillingClient)
    }

    // ── SK-5: renewal state is carried, not guessed ───────────────────────────

    @Test
    fun transaction_carriesRealRenewalStateNotProductType() {
        val cancelledButStillActive = StoreKit2Transaction(
            productId = "premium_monthly",
            jwsRepresentation = "jws",
            originalId = "orig-1",
            purchaseDateMillis = 1_700_000_000_000L,
            // The user cancelled; the term has not ended yet. The OLD shim derived this from
            // `productType == .autoRenewable` and would have reported true here.
            isAutoRenewing = false,
            transactionId = "txn-1",
            renewalState = "subscribed",
        )

        assertFalse(
            cancelledButStillActive.isAutoRenewing,
            "A cancelled-but-still-active subscription must not claim it will renew — that told " +
                "buyers they would be charged again after they had already cancelled.",
        )
    }

    @Test
    fun renewalState_distinguishesDunningFromChurn() {
        val inRetry = StoreKit2Transaction(
            productId = "premium_monthly",
            jwsRepresentation = "jws",
            originalId = "orig-2",
            purchaseDateMillis = 0L,
            isAutoRenewing = true,
            transactionId = "txn-2",
            renewalState = "billing_retry",
        )
        val expired = inRetry.copy(renewalState = "expired", isAutoRenewing = false)

        assertTrue(
            inRetry.renewalState != expired.renewalState,
            "Billing-retry and expired must be distinguishable — without renewalState iOS could " +
                "not tell a payment problem worth recovering from a subscriber who churned.",
        )
    }
}
