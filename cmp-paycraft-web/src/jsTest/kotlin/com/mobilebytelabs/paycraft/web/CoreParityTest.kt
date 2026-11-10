package com.mobilebytelabs.paycraft.web

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.PayCraftInternalApi
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.contract.WebCheckoutRoute
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The browser SDK speaks the app SDK's wire contract — not a copy of it (paycraft-core-split AC-3/AC-4).
 * Each test drives the facade and compares what it sent / decided with what `PayCraftContract`
 * (cmp-paycraft-core) defines, so a change to the contract changes both SDKs or fails here.
 */
@OptIn(PayCraftInternalApi::class)
class CoreParityTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(net: FakeTransport, key: String = "pk_test_abc"): PayCraftWeb =
        PayCraftWeb(key, null, backend, "anon-key").also {
            it.transport = net
            it.store = TokenStore(MemoryKeyValue())
            it.now = { 1_000_000.0 }
            it.newDeviceId = { "dev-1" }
            it.deviceName = { "Chrome on Android" }
        }

    private fun signedIn(net: FakeTransport): PayCraftWeb = sdk(net).also {
        it.store.saveSignIn("srv_1", "a+b@mail.test")
    }

    @Test
    fun regionPriceIsCoresResolvedPrice() = runTest {
        val core = PayCraftContract.decodeConfigForWeb(PayCraftWebTest.CONFIG_JSON).products.single()
        val web = sdk(
            FakeTransport().on("/functions/v1/config") {
                PayCraftWebTest.CONFIG_JSON
            },
        ).loadConfig().products.single()
        assertEquals(core.resolvedPrice!!.amountCents, web.amountCents)
        assertEquals(core.resolvedPrice!!.currency, web.currency)
        assertEquals(core.displayName, web.name)
    }

    @Test
    fun verifyBodyIsTheContractBodyWithTheRawNonce() = runTest {
        val net = FakeTransport()
            .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"apple"}""" }
            .on("/rest/v1/rpc/register_device") { """{"server_token":"srv","conflict":false}""" }
        sdk(net).doSignIn("apple", "tok", "n-1")
        assertEquals(
            PayCraftContract.identityVerifyBody("pk_test_abc", "apple", "tok", "n-1").toString(),
            net.calls[0].body,
        )
        assertEquals(PayCraftContract.identityVerifyUrl(backend), net.calls[0].url)
    }

    @Test
    fun registerDeviceParamsAreTheContractParams() = runTest {
        val net = FakeTransport()
            .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"google"}""" }
            .on("/rest/v1/rpc/register_device") { """{"server_token":"srv","conflict":false}""" }
        sdk(net).doSignIn("google", "tok", null)
        assertEquals(
            PayCraftContract.registerDeviceParams(
                "a@x.com",
                "web",
                "Chrome on Android",
                "dev-1",
                "test",
                "pk_test_abc",
            ).toString(),
            net.calls[1].body,
        )
        assertEquals(PayCraftContract.rpcUrl(backend, "register_device"), net.calls[1].url)
    }

    @Test
    fun headersAreTheContractHeaders() = runTest {
        val net = FakeTransport().on("/functions/v1/config") { PayCraftWebTest.CONFIG_JSON }
        sdk(net).loadConfig()
        assertEquals(PayCraftContract.headers("anon-key", "web", "test", json = false), net.calls[0].headers)
        assertEquals(PayCraftContract.configUrl(backend, "pk_test_abc"), net.calls[0].url)
    }

    @Test
    fun checkoutFollowsTheContractRouting() = runTest {
        // Stripe: link with the prefilled, encoded email
        val stripe = FakeTransport().on("/functions/v1/config") { PayCraftWebTest.STRIPE_CONFIG_JSON }
        val stripeUrl = signedIn(stripe).resolveCheckoutUrl("pro-monthly", null)
        val expected = PayCraftContract.routeWebCheckout(
            PayCraftContract.decodeConfigForWeb(PayCraftWebTest.STRIPE_CONFIG_JSON),
            "pro-monthly",
            true,
            null,
            "a+b@mail.test",
        ) as WebCheckoutRoute.PaymentLink
        assertEquals(expected.url, stripeUrl)
        // Razorpay link product: the link itself
        val link = FakeTransport().on("/functions/v1/config") { PayCraftWebTest.RAZORPAY_LINK_CONFIG_JSON }
        val linkRoute = PayCraftContract.routeWebCheckout(
            PayCraftContract.decodeConfigForWeb(PayCraftWebTest.RAZORPAY_LINK_CONFIG_JSON),
            "lifetime",
            true,
            null,
            "a+b@mail.test",
        ) as WebCheckoutRoute.PaymentLink
        assertEquals(linkRoute.url, signedIn(link).resolveCheckoutUrl("lifetime", null))
        // Razorpay subscription without a link: server checkout at the contract's URL
        val server = FakeTransport()
            .on("/functions/v1/config") { PayCraftWebTest.CONFIG_JSON }
            .on("/functions/v1/checkout-initiate") { """{"url":"https://rzp.io/i/sub_1"}""" }
        assertEquals("https://rzp.io/i/sub_1", signedIn(server).resolveCheckoutUrl("pro-monthly", null))
        assertEquals(PayCraftContract.checkoutInitiateUrl(backend, "pk_test_abc"), server.calls.last().url)
    }

    @Test
    fun cloudDefaultsComeFromCore() = runTest {
        val net = FakeTransport().on("/functions/v1/config") { PayCraftWebTest.CONFIG_JSON }
        PayCraftWeb("pk_live_x").also {
            it.transport = net
            it.store = TokenStore(MemoryKeyValue())
        }.loadConfig()
        assertTrue(net.calls[0].url.startsWith(PayCraftBackend.Cloud.supabaseUrl))
        assertEquals(PayCraftBackend.Cloud.supabaseAnonKey, net.calls[0].headers["apikey"])
    }
}
