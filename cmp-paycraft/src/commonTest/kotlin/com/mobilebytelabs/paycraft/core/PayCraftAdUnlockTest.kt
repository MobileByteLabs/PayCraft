package com.mobilebytelabs.paycraft.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The time-boxed rewarded-ad grant contract. */
class PayCraftAdUnlockTest {

    @AfterTest
    fun tearDown() = PayCraftAdUnlock.resetForTest()

    @Test
    fun noGrant_isLocked() {
        assertFalse(PayCraftAdUnlock.isUnlocked("f"))
        assertNull(PayCraftAdUnlock.expiresAt("f"))
    }

    @Test
    fun grant_unlocksUntilTheDeadline() {
        PayCraftAdUnlock.grant("f", durationMillis = 60_000)
        assertTrue(PayCraftAdUnlock.isUnlocked("f"))
    }

    @Test
    fun anExpiredGrantIsLocked_andIsCleanedUpOnRead() {
        // Negative durations are rejected, so expiry is reached by granting the smallest possible
        // window and reading it back after it has already passed.
        PayCraftAdUnlock.grant("f", durationMillis = 1)
        // 1ms window: by the time the read happens the deadline is in the past.
        while (PayCraftAdUnlock.expiresAt("f") != null) { /* spin until the 1ms deadline passes */ }
        assertFalse(PayCraftAdUnlock.isUnlocked("f"))
        assertNull(PayCraftAdUnlock.expiresAt("f"), "the dead row must not linger in the store")
    }

    @Test
    fun grantsAreScopedPerFeature() {
        PayCraftAdUnlock.grant("a")
        assertTrue(PayCraftAdUnlock.isUnlocked("a"))
        assertFalse(PayCraftAdUnlock.isUnlocked("b"), "unlocking one feature must not unlock another")
    }

    @Test
    fun reGrantingExtends_butNeverShortens() {
        // Re-watching with 24h left must not cut the window down to the shorter new one — that would
        // punish the viewer for watching another ad.
        PayCraftAdUnlock.grant("f", durationMillis = 10_000_000)
        val long = PayCraftAdUnlock.expiresAt("f")!!
        PayCraftAdUnlock.grant("f", durationMillis = 1_000)
        assertEquals(long, PayCraftAdUnlock.expiresAt("f"), "a shorter re-grant must not shorten the window")
    }

    @Test
    fun revoke_clearsTheGrant() {
        PayCraftAdUnlock.grant("f")
        PayCraftAdUnlock.revoke("f")
        assertFalse(PayCraftAdUnlock.isUnlocked("f"))
    }

    @Test
    fun aNonPositiveDurationIsRejected() {
        // A zero/negative window would write an already-expired row and read as "unlocked then
        // instantly not", which is worse than refusing the call.
        assertFailsWith<IllegalArgumentException> { PayCraftAdUnlock.grant("f", durationMillis = 0) }
        assertFailsWith<IllegalArgumentException> { PayCraftAdUnlock.grant("f", durationMillis = -1) }
    }

    @Test
    fun defaultWindowIs24h() {
        assertEquals(24L * 60L * 60L * 1000L, PayCraftAdUnlock.DEFAULT_UNLOCK_MILLIS)
    }

    @Test
    fun revisionAdvancesOnEveryMutation() {
        // Compose needs this to recompose; without it a granted reward never reaches the gate.
        val before = PayCraftAdUnlock.revision.value
        PayCraftAdUnlock.grant("f")
        val afterGrant = PayCraftAdUnlock.revision.value
        assertTrue(afterGrant > before, "grant must advance the revision")
        PayCraftAdUnlock.revoke("f")
        assertTrue(PayCraftAdUnlock.revision.value > afterGrant, "revoke must advance the revision")
    }
}
