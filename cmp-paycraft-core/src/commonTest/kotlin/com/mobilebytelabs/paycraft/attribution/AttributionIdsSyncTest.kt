package com.mobilebytelabs.paycraft.attribution

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `PayCraft.setAttributionIds` delivery (migration 208): ids wait for a device token, go once per
 * (token, ids), are resent when either changes, and a failing send is retried — never thrown.
 */
class AttributionIdsSyncTest {

    private val sent = mutableListOf<Triple<String, String?, String?>>()
    private var answer: () -> Boolean = { true }
    private val sync = AttributionIdsSync { token, fb, af -> sent += Triple(token, fb, af); answer() }

    @Test fun nothing_to_send_without_ids() = runTest {
        assertTrue(sync.flush("tok"))
        assertTrue(sent.isEmpty())
    }

    @Test fun waits_for_the_device_token_then_sends_once() = runTest {
        sync.set(firebaseAppInstanceId = "fb-1", appsFlyerId = null)
        assertFalse(sync.flush(null), "no token yet — try again later")
        assertTrue(sync.flush("tok"))
        assertTrue(sync.flush("tok"))
        assertEquals(listOf(Triple<String, String?, String?>("tok", "fb-1", null)), sent)
    }

    @Test fun resends_when_an_id_or_the_token_changes_and_null_keeps_the_other() = runTest {
        sync.set("fb-1", null)
        sync.flush("tok")
        sync.set(null, "af-1")
        sync.flush("tok")
        sync.flush("tok-2")
        assertEquals(
            listOf<Triple<String, String?, String?>>(Triple("tok", "fb-1", null), Triple("tok", "fb-1", "af-1"), Triple("tok-2", "fb-1", "af-1")),
            sent,
        )
    }

    @Test fun a_failing_or_throwing_send_is_retried_and_never_thrown() = runTest {
        sync.set("fb-1", null)
        answer = { error("offline") }
        assertFalse(sync.flush("tok"))
        answer = { false }
        assertFalse(sync.flush("tok"))
        answer = { true }
        assertTrue(sync.flush("tok"))
        assertEquals(3, sent.size)
    }

    @Test fun body_omits_absent_ids() {
        val b = AttributionIdsSync.body("pk_1", "tok", "fb-1", null)
        assertEquals("fb-1", b["firebaseAppInstanceId"]?.jsonPrimitive?.content)
        assertEquals("tok", b["deviceToken"]?.jsonPrimitive?.content)
        assertNull(b["appsFlyerId"])
    }
}
