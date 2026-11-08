package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Behaviour of the website SDK against a fake network and in-memory storage.
 *
 * The contract a website relies on: sign-in goes through the SAME path as the mobile SDK (verified
 * Google/Apple identity → register_device with that email → device token), premium is checked with
 * that token, and `isAdFree()` answers synchronously from the cache so a page can decide before it
 * loads a single ad. Storage failures (private mode, blocked site data) must never throw.
 */
class PayCraftWebTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(
        net: FakeTransport,
        kv: KeyValue = MemoryKeyValue(),
        key: String = "pk_test_abc",
    ): PayCraftWeb = PayCraftWeb(key, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(kv)
        it.now = { 1_000_000.0 }
        it.newDeviceId = { "dev-1" }
        it.deviceName = { "Chrome on Android" }
    }

    @Test
    fun configParsesProductsProvidersAndClientIds() = runTest {
        val net = FakeTransport().on("/functions/v1/config") { CONFIG_JSON }
        val cfg = sdk(net).loadConfig()
        assertEquals(1, cfg.products.size)
        assertEquals("pro_monthly", cfg.products[0].sku)
        assertEquals(19900, cfg.products[0].amountCents)
        assertEquals("INR", cfg.products[0].currency)
        assertEquals("razorpay", cfg.providers[0])
        assertEquals("web-client.apps.googleusercontent.com", cfg.googleClientId)
        val call = net.calls.single()
        assertEquals("GET", call.method)
        assertTrue(call.url.endsWith("/functions/v1/config?apiKey=pk_test_abc"))
        assertEquals("anon-key", call.headers["apikey"])
        assertEquals("Bearer anon-key", call.headers["Authorization"])
        assertEquals("web", call.headers["x-paycraft-platform"])
        assertEquals("test", call.headers["x-paycraft-mode"])
    }

    @Test
    fun signInVerifiesTheIdentityThenRegistersWithTheVerifiedEmail() = runTest {
        val net = FakeTransport()
            .on("/functions/v1/identity-token/verify") { """{"email":"a+b@x.com","provider":"google"}""" }
            .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
        val pc = sdk(net)
        val result = pc.doSignIn("google", "id-token-1", null)
        assertEquals("a+b@x.com", result.email)
        assertFalse(result.conflict)
        val verify = net.body(0)
        assertEquals("pk_test_abc", verify["api_key"]!!.jsonPrimitive.content)
        assertEquals("google", verify["provider"]!!.jsonPrimitive.content)
        assertEquals("id-token-1", verify["id_token"]!!.jsonPrimitive.content)
        val reg = net.body(1)
        assertEquals("a+b@x.com", reg["p_email"]!!.jsonPrimitive.content)
        assertEquals("web", reg["p_platform"]!!.jsonPrimitive.content)
        assertEquals("dev-1", reg["p_device_id"]!!.jsonPrimitive.content)
        assertEquals("test", reg["p_mode"]!!.jsonPrimitive.content)
        assertEquals("pk_test_abc", reg["p_api_key"]!!.jsonPrimitive.content)
        assertEquals("a+b@x.com", pc.email())
    }

    @Test
    fun aRejectedIdentityNeverRegistersADevice() = runTest {
        val net = FakeTransport().on("/functions/v1/identity-token/verify", status = 401) { """{"error":"invalid_token"}""" }
        val pc = sdk(net)
        assertFailsWith<PayCraftWebError> { pc.doSignIn("google", "bad", null) }
        assertEquals(1, net.calls.size)
        assertNull(pc.email())
    }

    @Test
    fun premiumSendsTheStoredTokenAndKeyAndIsCached() = runTest {
        val net = signedIn().on("/rest/v1/rpc/check_premium_with_device") {
            """{"is_premium":true,"token_valid":true,"email":"a+b@x.com"}"""
        }
        val pc = sdk(net)
        pc.doSignIn("google", "t", null)
        assertFalse(pc.isPremium())
        val state = pc.refreshPremium()
        assertTrue(state.isPremium)
        val body = net.bodyOf("/rest/v1/rpc/check_premium_with_device")
        assertEquals("srv_1", body["p_server_token"]!!.jsonPrimitive.content)
        assertEquals("pk_test_abc", body["p_api_key"]!!.jsonPrimitive.content)
        assertTrue(pc.isPremium())
    }

    @Test
    fun isAdFreeMirrorsPremiumAndIsFalseWithoutACache() = runTest {
        val kv = MemoryKeyValue()
        val net = signedIn().on("/rest/v1/rpc/check_premium_with_device") {
            """{"is_premium":true,"token_valid":true,"email":"a+b@x.com"}"""
        }
        val fresh = sdk(net, kv)
        assertFalse(fresh.isAdFree())
        fresh.doSignIn("google", "t", null)
        fresh.refreshPremium()
        assertTrue(fresh.isAdFree())
        // a new page load reads the same storage synchronously
        assertTrue(sdk(FakeTransport(), kv).isAdFree())
    }

    @Test
    fun anExpiredCacheIsNotTrusted() = runTest {
        val kv = MemoryKeyValue()
        val net = signedIn().on("/rest/v1/rpc/check_premium_with_device") {
            """{"is_premium":true,"token_valid":true,"email":"a+b@x.com"}"""
        }
        val pc = sdk(net, kv)
        pc.doSignIn("google", "t", null)
        pc.refreshPremium()
        val later = sdk(FakeTransport(), kv).also { it.now = { 1_000_000.0 + PREMIUM_CACHE_TTL_MS + 1 } }
        assertFalse(later.isAdFree())
    }

    @Test
    fun noTokenMeansNotPremiumWithoutAnyNetworkCall() = runTest {
        val net = FakeTransport()
        val state = sdk(net).refreshPremium()
        assertFalse(state.isPremium)
        assertEquals(0, net.calls.size)
    }

    @Test
    fun razorpayCheckoutPostsTheSignedInEmail() = runTest {
        val net = signedIn()
            .on("/functions/v1/config") { CONFIG_JSON }
            .on("/functions/v1/checkout-initiate") { """{"url":"https://rzp.io/i/abc","provider":"razorpay"}""" }
        val pc = sdk(net)
        pc.doSignIn("google", "t", null)
        assertEquals("https://rzp.io/i/abc", pc.resolveCheckoutUrl("pro_monthly", "INR"))
        val call = net.calls.last()
        assertTrue(call.url.endsWith("/functions/v1/checkout-initiate?apiKey=pk_test_abc"))
        val body = Json.parseToJsonElement(call.body!!).jsonObject
        assertEquals("pro_monthly", body["sku"]!!.jsonPrimitive.content)
        assertEquals("INR", body["currency"]!!.jsonPrimitive.content)
        assertEquals("a+b@x.com", body["customer"]!!.jsonObject["email"]!!.jsonPrimitive.content)
    }

    @Test
    fun stripeCheckoutUsesThePaymentLinkWithAnEncodedEmail() = runTest {
        val net = signedIn().on("/functions/v1/config") { STRIPE_CONFIG_JSON }
        val pc = sdk(net)
        pc.doSignIn("google", "t", null)
        assertEquals(
            "https://buy.stripe.com/test_1?prefilled_email=a%2Bb%40x.com",
            pc.resolveCheckoutUrl("pro_monthly", "USD"),
        )
    }

    @Test
    fun checkoutRequiresSignIn() = runTest {
        val net = FakeTransport().on("/functions/v1/config") { CONFIG_JSON }
        assertFailsWith<PayCraftWebError> { sdk(net).resolveCheckoutUrl("pro_monthly", null) }
    }

    @Test
    fun aConflictIsReportedAndUseThisDeviceTransfersIt() = runTest {
        val net = FakeTransport()
            .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"apple"}""" }
            .on("/rest/v1/rpc/register_device") {
                """{"server_token":"srv_2","conflict":true,"conflicting_device_name":"Pixel 7"}"""
            }
            .on("/rest/v1/rpc/transfer_to_device") { """{"transferred":true}""" }
            .on("/rest/v1/rpc/check_premium_with_device") { """{"is_premium":true,"token_valid":true}""" }
        val pc = sdk(net)
        val r = pc.doSignIn("apple", "t", "nonce-1")
        assertTrue(r.conflict)
        assertEquals("Pixel 7", r.conflictingDeviceName)
        assertEquals("nonce-1", net.body(0)["nonce"]!!.jsonPrimitive.content)
        assertTrue(pc.doUseThisDevice())
        val t = net.bodyOf("/rest/v1/rpc/transfer_to_device")
        assertEquals("srv_2", t["p_server_token"]!!.jsonPrimitive.content)
        assertEquals("srv_2", t["p_new_device_token"]!!.jsonPrimitive.content)
        assertTrue(pc.isPremium())
    }

    @Test
    fun signOutClearsTheTokenEmailAndCache() = runTest {
        val kv = MemoryKeyValue()
        val net = signedIn().on("/rest/v1/rpc/check_premium_with_device") {
            """{"is_premium":true,"token_valid":true}"""
        }
        val pc = sdk(net, kv)
        pc.doSignIn("google", "t", null)
        pc.refreshPremium()
        pc.signOut()
        assertFalse(pc.isAdFree())
        assertNull(pc.email())
        assertTrue(kv.isEmptyExceptDeviceId())
    }

    @Test
    fun storageThatThrowsNeverBreaksThePage() = runTest {
        val net = signedIn().on("/rest/v1/rpc/check_premium_with_device") { """{"is_premium":true,"token_valid":true}""" }
        val pc = sdk(net, ThrowingKeyValue())
        assertFalse(pc.isAdFree())
        pc.doSignIn("google", "t", null)
        pc.refreshPremium()
        pc.signOut()
        assertNull(pc.email())
    }

    private fun signedIn() = FakeTransport()
        .on("/functions/v1/identity-token/verify") { """{"email":"a+b@x.com","provider":"google"}""" }
        .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }

    private companion object {
        val CONFIG_JSON = """
            {"tenant_id":"t1","products":[{"id":"p1","sku":"pro_monthly","type":"subscription",
              "display_name":"Pro","interval":"month","base_price_cents":19900,"base_currency":"INR",
              "trial_duration_days":7,"resolved_price":{"amount_cents":19900,"currency":"INR","source":"global"}}],
             "providers":[{"provider":"razorpay","test_payment_links":{"pro_monthly":{}}}],
             "mode":"ad_supported",
             "auth":{"google_web_client_id":"web-client.apps.googleusercontent.com","apple_services_id":"com.x.signin"}}
        """.trimIndent()
        val STRIPE_CONFIG_JSON = """
            {"products":[{"id":"p1","sku":"pro_monthly","type":"subscription","display_name":"Pro",
              "interval":"month","base_price_cents":500,"base_currency":"USD"}],
             "providers":[{"provider":"stripe","test_payment_links":{"pro_monthly":{"USD":"https://buy.stripe.com/test_1"}},
                           "live_payment_links":{"pro_monthly":{"USD":"https://buy.stripe.com/live_1"}}}]}
        """.trimIndent()
    }
}

internal class FakeTransport : Transport {
    class Call(val method: String, val url: String, val headers: Map<String, String>, val body: String?)

    private val routes = mutableListOf<Triple<String, Int, () -> String>>()
    val calls = mutableListOf<Call>()

    fun on(path: String, status: Int = 200, body: () -> String): FakeTransport = apply { routes += Triple(path, status, body) }

    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResult {
        calls += Call(method, url, headers, body)
        val route = routes.lastOrNull { url.substringBefore('?').endsWith(it.first) }
            ?: return HttpResult(404, """{"error":"no fake route for $url"}""")
        return HttpResult(route.second, route.third())
    }

    fun body(index: Int): JsonObject = Json.parseToJsonElement(calls[index].body!!).jsonObject

    fun bodyOf(path: String): JsonObject =
        Json.parseToJsonElement(calls.last { it.url.substringBefore('?').endsWith(path) }.body!!).jsonObject
}

internal class MemoryKeyValue : KeyValue {
    private val map = mutableMapOf<String, String>()
    override fun get(key: String): String? = map[key]
    override fun set(key: String, value: String) {
        map[key] = value
    }
    override fun remove(key: String) {
        map.remove(key)
    }
    fun isEmptyExceptDeviceId(): Boolean = map.keys.all { it == DEVICE_ID_KEY }
}

internal class ThrowingKeyValue : KeyValue {
    override fun get(key: String): String? = error("SecurityError: storage blocked")
    override fun set(key: String, value: String) = error("QuotaExceededError")
    override fun remove(key: String) = error("SecurityError: storage blocked")
}
