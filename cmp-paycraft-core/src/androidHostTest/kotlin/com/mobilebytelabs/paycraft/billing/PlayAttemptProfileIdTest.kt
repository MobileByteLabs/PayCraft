package com.mobilebytelabs.paycraft.billing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A Play purchase carries the attempt on its receipt (paycraft-attempt-observability D5, AC-11): the profile id is
 * the attempt id — verbatim, because google-rtdn reads it back as the attempt — while the account id stays the
 * hashed USER, exactly as before attempt tracking existed.
 */
class PlayAttemptProfileIdTest {
    private var accountId: String? = null
    private var profileId: String? = null

    private fun apply(appUserId: String?, attemptId: String?) = applyReceiptIdentifiers(
        appUserId = appUserId,
        attemptId = attemptId,
        setAccountId = { accountId = it },
        setProfileId = { profileId = it },
    )

    @Test fun flow_params_carry_the_attempt_as_profile_id_and_account_id_stays_the_user() {
        apply(appUserId = "alice@x.com", attemptId = "1764000000000-00ab12cd34ef5678")
        assertEquals("1764000000000-00ab12cd34ef5678", profileId)
        assertEquals(obfuscateAppUserId("alice@x.com"), accountId)
        assertTrue(accountId!!.none { it == '@' }, "the account id never carries the raw email")
    }

    @Test fun the_account_id_hash_is_unchanged_by_attempt_tracking() {
        // The value every purchase before this change carried for this user — entitlement attribution reads it.
        apply(appUserId = "alice@x.com", attemptId = null)
        assertEquals("28ba78289e67e1536677a8cc70a312b", accountId)
        assertNull(profileId, "no attempt, no profile id")
        assertTrue(accountId!!.length <= PLAY_OBFUSCATED_ID_MAX)
    }

    @Test fun an_attempt_id_play_would_refuse_is_left_off_rather_than_failing_the_purchase() {
        apply(appUserId = "alice@x.com", attemptId = "a".repeat(PLAY_OBFUSCATED_ID_MAX + 1))
        assertNull(profileId)
        assertEquals(obfuscateAppUserId("alice@x.com"), accountId)
    }

    @Test fun the_sdk_minted_attempt_id_always_fits_the_profile_id() {
        val minted = com.mobilebytelabs.paycraft.analytics.mintAttemptId(1_764_000_000_000L)
        apply(appUserId = null, attemptId = minted)
        assertEquals(minted, profileId)
        assertNull(accountId)
    }
}
