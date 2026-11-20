package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.await
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** `verifyIdentity`: the site's own auth session (e.g. its Supabase access token) binds this browser's PayCraft device. */
class WebVerifyIdentityTest {
    private fun sdk(net: FakeTransport): PayCraftWeb =
        PayCraftWeb("pk_live_abc", null, "https://example.supabase.co", "anon-key").also {
            it.transport = net
            it.store = TokenStore(MemoryKeyValue())
        }

    @Test
    fun sendsTheAccessTokenWithThisBrowsersDeviceToken() = runTest {
        val net = FakeTransport().on("/functions/v1/identity-verify") { """{"subject_id":"s-1","verified":true}""" }
        val pc = sdk(net).also { it.store.saveSignIn("srv_1", "a@x.com") }

        val reply = Json.parseToJsonElement(pc.verifyIdentity("jwt-1").await()).jsonObject
        assertEquals("true", reply["verified"]!!.jsonPrimitive.content)

        val body = Json.parseToJsonElement(net.calls.single().body!!).jsonObject
        assertEquals("pk_live_abc", body["api_key"]!!.jsonPrimitive.content)
        assertEquals("jwt-1", body["access_token"]!!.jsonPrimitive.content)
        assertEquals("srv_1", body["device_token"]!!.jsonPrimitive.content)
        assertEquals("web", body["platform"]!!.jsonPrimitive.content)
    }

    @Test
    fun signedOutRejectsWithoutCallingTheServer() = runTest {
        val net = FakeTransport()
        val e = assertFailsWith<PayCraftWebError> { sdk(net).verifyIdentity("jwt-1").await() }
        assertEquals("sign_in_required", e.code)
        assertTrue(net.calls.isEmpty())
    }

    @Test
    fun aRefusalSurfacesTheServersReason() = runTest {
        val net = FakeTransport().on("/functions/v1/identity-verify", 409) {
            """{"error":"verified_identity_not_configured"}"""
        }
        val pc = sdk(net).also { it.store.saveSignIn("srv_1", "a@x.com") }
        val e = assertFailsWith<PayCraftWebError> { pc.verifyIdentity("jwt-1").await() }
        assertEquals("http_409", e.code)
        assertEquals("verified_identity_not_configured", e.message)
    }
}
