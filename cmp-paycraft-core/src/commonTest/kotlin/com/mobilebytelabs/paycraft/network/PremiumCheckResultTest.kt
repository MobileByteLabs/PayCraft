package com.mobilebytelabs.paycraft.network

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A device token answers for the email it was registered with — never trust it for another one. */
class PremiumCheckResultTest {

    @Test
    fun tokenBoundToAnotherAccountIsNotThisUsers() {
        val check = PremiumCheckResult(isPremium = false, tokenValid = true, boundEmail = "old@test.local")
        assertFalse(check.isBoundTo("new@test.local"))
    }

    @Test
    fun sameAccountMatchesIgnoringCaseAndSpace() {
        val check = PremiumCheckResult(isPremium = true, tokenValid = true, boundEmail = "user@test.local")
        assertTrue(check.isBoundTo(" User@Test.local "))
    }

    @Test
    fun olderServerWithoutEmailIsTrusted() {
        assertTrue(PremiumCheckResult(isPremium = true, tokenValid = true).isBoundTo("any@test.local"))
    }
}
