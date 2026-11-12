package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.await
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * `deviceCall` — the core's one door to the metered-action and balance RPCs (migration 189 + 157) that
 * paycraft-web-ui's allowance helpers use: only the allowed RPCs, only as the signed-in device, and the browser's
 * own token and key always override anything the page passes.
 */
class WebBalanceTest {
    private val backend = "https://example.supabase.co"

    private fun sdk(net: FakeTransport): PayCraftWeb = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(MemoryKeyValue())
        it.newDeviceId = { "dev-web-1" }
        it.deviceName = { "Chrome on Mac" }
    }

    private fun net() = FakeTransport()
        .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"google"}""" }
        .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
        .on("/rest/v1/rpc/allowance_status") { """{"free_per_month":5,"used":2}""" }
        .on("/rest/v1/rpc/allowance_spend") { "\"allowance\"" }

    private suspend fun signedIn(n: FakeTransport) = sdk(n).also { it.signIn("google", "id-token", null).await() }

    @Test fun calls_an_allowed_rpc_as_this_device() = runTest {
        val n = net()
        val body = signedIn(n).deviceCall("allowance_status", "kw-full-edit", null).await()
        assertEquals("""{"free_per_month":5,"used":2}""", body)
        val sent = n.body(n.calls.indexOfLast { it.url.contains("allowance_status") })
        assertEquals("srv_1", sent["p_server_token"]!!.jsonPrimitive.content)
        assertEquals("pk_test_abc", sent["p_api_key"]!!.jsonPrimitive.content)
        assertEquals("kw-full-edit", sent["p_sku"]!!.jsonPrimitive.content)
    }

    @Test fun signed_out_calls_fail_with_sign_in_required() = runTest {
        val e = assertFailsWith<Throwable> { sdk(net()).deviceCall("allowance_status", "x", null).await() }
        assertTrue(e.message!!.contains("Sign in"), e.message)
    }
}

class WebBalanceSpendTest {
    @Test fun spend_sends_the_idempotency_key_as_this_device() = runTest {
        val n = FakeTransport()
            .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"google"}""" }
            .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
            .on("/rest/v1/rpc/allowance_spend") { "\"allowance\"" }
        val pc = PayCraftWeb("pk_test_abc", null, "https://example.supabase.co", "anon-key").also {
            it.transport = n
            it.store = TokenStore(MemoryKeyValue())
            it.newDeviceId = { "dev-web-1" }
            it.deviceName = { "Chrome on Mac" }
        }
        pc.signIn("google", "id-token", null).await()
        assertEquals("\"allowance\"", pc.deviceCall("allowance_spend", "kw-full-edit", "export-42").await())
        val sent = n.body(n.calls.indexOfLast { it.url.contains("allowance_spend") })
        assertEquals("export-42", sent["p_idempotency_key"]!!.jsonPrimitive.content)
        assertEquals("srv_1", sent["p_server_token"]!!.jsonPrimitive.content)
    }
}
