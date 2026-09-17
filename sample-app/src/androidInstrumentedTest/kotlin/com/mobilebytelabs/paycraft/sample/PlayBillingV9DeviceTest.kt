package com.mobilebytelabs.paycraft.sample

import androidx.test.platform.app.InstrumentationRegistry
import com.mobilebytelabs.paycraft.billing.NativeProductType
import com.mobilebytelabs.paycraft.billing.PlayBillingNativeClient
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * ON-DEVICE verification of the Play Billing **v9** runtime.
 *
 * A clean compile against 9.1.0 proves API compatibility and nothing else. These tests exercise the
 * paths that can only fail at runtime, against the real Play Store service on the device:
 *
 *  - the v9 connect handshake (`startConnection` → `onBillingSetupFinished`), including the bounded
 *    exponential backoff added for PB-9;
 *  - `getBillingConfigAsync` → the storefront country read, which is what decides billing region;
 *  - `queryPurchasesAsync` over BOTH `SUBS` and `INAPP` (PB-5) — the SUBS-only query is what made a
 *    lifetime purchase invisible to restore;
 *  - `queryProductDetails` for both product types, and its graceful null for an unknown product.
 *
 * Deliberately NOT asserted: an actual purchase. `launchBillingFlow` requires this applicationId to
 * be published on Play Console with configured products and a licensed tester account; none of that
 * exists for the sample app. What is provable here is that the v9 client connects and its query
 * surface behaves — which is exactly what the version bump put at risk.
 *
 * Run: `./gradlew :sample-app:connectedDebugAndroidTest --tests "*PlayBillingV9DeviceTest*"`
 */
class PlayBillingV9DeviceTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    /** No Activity is needed for query-only paths; purchase is not exercised here. */
    private fun client() = PlayBillingNativeClient(context = context, activityProvider = { null })

    @Test
    fun connectsToPlayAndReportsAStorefront() = runBlocking {
        val storefront = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { client().storefrontCountry() }

        // A null return is a legitimate outcome (no Play services / no signed-in account), so the
        // assertion is on SHAPE: if Play answered, it must be a real ISO-3166 alpha-2 code. A v9
        // connect regression would surface as a timeout (null from withTimeoutOrNull) or a crash.
        assertNotNull(
            storefront,
            "getBillingConfigAsync returned nothing within ${CONNECT_TIMEOUT_MS}ms — the v9 " +
                "connect handshake did not complete on this device.",
        )
        assertTrue(
            storefront.length == 2 && storefront.all { it.isLetter() },
            "Storefront must be an ISO-3166 alpha-2 code; got '$storefront'.",
        )
    }

    @Test
    fun queryPurchasesCoversBothProductTypesWithoutError() = runBlocking {
        // PB-5: this call now sweeps SUBS *and* INAPP. An empty list is the expected result on a
        // device with no purchases; what matters is that neither query throws against v9.
        val purchases = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { client().queryPurchases() }

        assertNotNull(
            purchases,
            "queryPurchases (SUBS + INAPP) did not complete — a v9 query-path regression.",
        )
        // Any purchase that IS present must be well-formed, since restore and the unfinished-sweep
        // both key on these fields.
        purchases.forEach { p ->
            assertTrue(p.productId.isNotBlank(), "A returned purchase carried a blank productId.")
            assertTrue(p.purchaseToken.isNotBlank(), "A returned purchase carried a blank token.")
        }
    }

    @Test
    fun unknownProductPricesToNullRatherThanThrowing() = runBlocking {
        // The sample app has no Play Console products, so this exercises the not-found path — which
        // must degrade to null so the paywall falls back to the cloud price rather than crashing.
        val subs = withTimeoutOrNull(CONNECT_TIMEOUT_MS) {
            client().nativeDisplayPrice("paycraft.device.test.absent", NativeProductType.SUBSCRIPTION)
        }
        val oneTime = withTimeoutOrNull(CONNECT_TIMEOUT_MS) {
            client().nativeDisplayPrice("paycraft.device.test.absent", NativeProductType.ONE_TIME)
        }

        assertTrue(subs == null, "An absent SUBS product must price to null, not a partial value.")
        assertTrue(oneTime == null, "An absent INAPP product must price to null, not a partial value.")
    }

    @Test
    fun clientClosesCleanly() = runBlocking {
        // PB-9: endConnection() was never called before. Closing must release the binding and leave
        // the client refusing further work rather than reconnecting behind our back.
        val c = client()
        withTimeoutOrNull(CONNECT_TIMEOUT_MS) { c.storefrontCountry() }
        c.close()

        val afterClose = withTimeoutOrNull(CONNECT_TIMEOUT_MS) { c.storefrontCountry() }
        assertTrue(
            afterClose == null,
            "A closed client must not resolve a storefront — the connection was not released.",
        )
    }

    private companion object {
        /** Generous: a cold Play Store bind on a real device can take seconds. */
        const val CONNECT_TIMEOUT_MS = 30_000L
    }
}
