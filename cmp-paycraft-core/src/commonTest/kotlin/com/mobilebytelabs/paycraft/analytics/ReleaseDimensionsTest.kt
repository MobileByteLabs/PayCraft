package com.mobilebytelabs.paycraft.analytics

import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.core.identity.SignInFailure
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.core.identity.signInFailure
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/**
 * Realtime analytics: every event carries the app version, build and OS version (`app_version`, `app_build`,
 * `os_version`) — in GA4 params, on the `events` wire and through the persisted retry queue — filled once by the
 * emitter, capped (40 / 20 characters, build ≥ 0); and a sign-in that ends cancelled or failed maps to
 * `paycraft_sign_in_fail`'s provider + reason.
 */
class ReleaseDimensionsTest {

    private fun ev(appVersion: String? = null, appBuild: Long? = null, osVersion: String? = null) = PayCraftEvent(
        PayCraftEventName.PaywallView,
        PayCraftStep.Paywall,
        platform = "android",
        atMs = 1,
        appVersion = appVersion,
        appBuild = appBuild,
        osVersion = osVersion,
    )

    @Test fun params_carry_the_three_release_keys_when_set() {
        val p = ev("2.4.1", 241, "15").params()
        assertEquals("2.4.1", p["app_version"])
        assertEquals("241", p["app_build"])
        assertEquals("15", p["os_version"])
    }

    @Test fun params_omit_the_release_keys_when_null_or_blank() {
        listOf(ev(), ev(appVersion = "  ", osVersion = "")).forEach { e ->
            val p = e.params()
            assertFalse("app_version" in p || "app_build" in p || "os_version" in p, p.toString())
        }
    }

    @Test fun values_are_capped_and_a_negative_build_is_dropped() {
        val p = ev("v".repeat(60), -1, "o".repeat(30)).params()
        assertEquals(40, p.getValue("app_version").length)
        assertEquals(20, p.getValue("os_version").length)
        assertNull(p["app_build"])
    }

    @Test fun the_events_wire_carries_them_per_event_capped() {
        val wire = PayCraftContract.eventsBody("pk_x", "dev-1", null, listOf(ev("v".repeat(60), 7, "17.2")))
        val e = wire["events"]!!.jsonArray[0].jsonObject
        assertEquals(40, e["app_version"]!!.jsonPrimitive.content.length)
        assertEquals(7L, e["app_build"]!!.jsonPrimitive.long)
        assertEquals("17.2", e["os_version"]!!.jsonPrimitive.content)

        val bare = PayCraftContract.eventsBody("pk_x", "dev-1", null, listOf(ev()))["events"]!!.jsonArray[0].jsonObject
        assertFalse("app_version" in bare || "app_build" in bare || "os_version" in bare, bare.toString())
    }

    @Test fun the_emitter_stamps_every_event_and_keeps_an_events_own_value() = runTest {
        val sent = mutableListOf<PayCraftEvent>()
        val seen = mutableListOf<Map<String, String>>()
        val a = PayCraftAnalytics(send = { sent += it }, stamp = { it.withApp("3.0", 30, "14") })
        a.listener = PayCraftAnalyticsListener { _, p -> seen += p }
        a.emit(ev())
        a.emit(ev(appVersion = "own"))
        a.flush()
        assertEquals(listOf("3.0", "own"), sent.map { it.appVersion })
        assertEquals(listOf(30L, 30L), sent.map { it.appBuild })
        assertEquals("14", seen[0]["os_version"], "the app's GA4 sees the stamped values too")
    }

    @Test fun the_persisted_queue_keeps_the_release_keys() = runTest {
        val settings = MapSettings()
        val a = PayCraftAnalytics(send = { error("offline") }, settings = settings, now = { 1L })
        a.emit(ev("2.0", 20, "13"))
        a.flush()
        val restored = PayCraftAnalytics.readQueue(settings).single()
        assertEquals("2.0", restored.appVersion)
        assertEquals(20L, restored.appBuild)
        assertEquals("13", restored.osVersion)
    }

    @Test fun sign_in_failure_maps_provider_and_reason() {
        assertEquals("google" to "cancelled", signInFailure(SignInState.Cancelled(OAuthProvider.GOOGLE)))
        val reasons = mapOf(
            SignInFailure.NotConfigured to "not_configured",
            SignInFailure.Network to "network",
            SignInFailure.Rejected to "rejected",
            SignInFailure.Unknown to "unknown",
        )
        reasons.forEach { (f, wire) ->
            assertEquals("apple" to wire, signInFailure(SignInState.Failed(OAuthProvider.APPLE, f)))
        }
        assertNull(signInFailure(SignInState.Linked("a@b.c", OAuthProvider.GOOGLE)))
        assertNull(signInFailure(SignInState.Verifying(OAuthProvider.GOOGLE)))
    }
}
