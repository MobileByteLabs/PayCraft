package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SyncPolicyTest {

    // ─── isSyncDue ──────────────────────────────────────────────

    @Test
    fun isSyncDue_noCachedStatus_returnsTrue() {
        assertTrue(SyncPolicy.isSyncDue(cached = null, lastSyncedAt = 1000L))
    }

    @Test
    fun isSyncDue_neverSynced_returnsTrue() {
        val status = SubscriptionStatus(isPremium = true)
        assertTrue(SyncPolicy.isSyncDue(cached = status, lastSyncedAt = 0L))
    }

    @Test
    fun isSyncDue_recentSync_returnsFalse() {
        val status = SubscriptionStatus(
            isPremium = true,
            expiresAt = futureIso(days = 30),
            willRenew = true,
        )
        // Synced just now — weekly interval, so not due
        val result = SyncPolicy.isSyncDue(cached = status, lastSyncedAt = currentTimeMillis())
        assertEquals(false, result)
    }

    // ─── syncInterval ───────────────────────────────────────────

    @Test
    fun syncInterval_freeUser_daily() {
        val status = SubscriptionStatus(isPremium = false)
        assertEquals(SyncPolicy.ONE_DAY, SyncPolicy.syncInterval(status))
    }

    @Test
    fun syncInterval_cancelledSubscription_daily() {
        val status = SubscriptionStatus(isPremium = true, willRenew = false)
        assertEquals(SyncPolicy.ONE_DAY, SyncPolicy.syncInterval(status))
    }

    @Test
    fun syncInterval_premiumExpiresFarFuture_weekly() {
        val status = SubscriptionStatus(
            isPremium = true,
            expiresAt = futureIso(days = 30),
            willRenew = true,
        )
        assertEquals(SyncPolicy.ONE_WEEK, SyncPolicy.syncInterval(status))
    }

    @Test
    fun syncInterval_premiumExpiresIn3Days_daily() {
        val status = SubscriptionStatus(
            isPremium = true,
            expiresAt = futureIso(days = 3),
            willRenew = true,
        )
        assertEquals(SyncPolicy.ONE_DAY, SyncPolicy.syncInterval(status))
    }

    @Test
    fun syncInterval_premiumExpiresIn12Hours_hourly() {
        val status = SubscriptionStatus(
            isPremium = true,
            expiresAt = futureIso(hours = 12),
            willRenew = true,
        )
        assertEquals(SyncPolicy.ONE_HOUR, SyncPolicy.syncInterval(status))
    }

    @Test
    fun syncInterval_nullExpiresAt_daily() {
        val status = SubscriptionStatus(
            isPremium = true,
            expiresAt = null,
            willRenew = true,
        )
        assertEquals(SyncPolicy.ONE_DAY, SyncPolicy.syncInterval(status))
    }

    // ─── parseExpiryToMillis ────────────────────────────────────

    @Test
    fun parseExpiryToMillis_validIso_returnsMillis() {
        // 2025-01-01T00:00:00Z = 1735689600000L
        val result = SyncPolicy.parseExpiryToMillis("2025-01-01T00:00:00Z")
        assertNotNull(result)
        assertEquals(1735689600000L, result)
    }

    @Test
    fun parseExpiryToMillis_withOffset_returnsMillis() {
        val result = SyncPolicy.parseExpiryToMillis("2025-01-01T00:00:00+00:00")
        assertNotNull(result)
        assertEquals(1735689600000L, result)
    }

    @Test
    fun parseExpiryToMillis_withFractionalSeconds_handlesGracefully() {
        val result = SyncPolicy.parseExpiryToMillis("2025-01-01T12:30:45.123Z")
        assertNotNull(result)
        // Should parse date/time, ignoring fractional part
        val expected = SyncPolicy.parseExpiryToMillis("2025-01-01T12:30:45Z")
        assertEquals(expected, result)
    }

    @Test
    fun parseExpiryToMillis_null_returnsNull() {
        assertNull(SyncPolicy.parseExpiryToMillis(null))
    }

    @Test
    fun parseExpiryToMillis_invalid_returnsNull() {
        assertNull(SyncPolicy.parseExpiryToMillis("not-a-date"))
    }

    @Test
    fun parseExpiryToMillis_epoch_returnsZero() {
        val result = SyncPolicy.parseExpiryToMillis("1970-01-01T00:00:00Z")
        assertNotNull(result)
        assertEquals(0L, result)
    }

    @Test
    fun parseExpiryToMillis_leapYear_handlesCorrectly() {
        // 2024-02-29T00:00:00Z — leap year date
        val result = SyncPolicy.parseExpiryToMillis("2024-02-29T00:00:00Z")
        assertNotNull(result)
        // 2024-03-01 should be exactly one day later
        val marchFirst = SyncPolicy.parseExpiryToMillis("2024-03-01T00:00:00Z")
        assertNotNull(marchFirst)
        assertEquals(SyncPolicy.ONE_DAY, marchFirst - result)
    }

    // ─── Helpers ────────────────────────────────────────────────

    /** Build a future ISO 8601 timestamp relative to now. */
    private fun futureIso(days: Int = 0, hours: Int = 0): String {
        val futureMs = currentTimeMillis() + days * SyncPolicy.ONE_DAY + hours * SyncPolicy.ONE_HOUR
        return millisToIso(futureMs)
    }

    /** Convert epoch millis to "YYYY-MM-DDTHH:MM:SSZ" (inverse of parser). */
    private fun millisToIso(millis: Long): String {
        val totalSeconds = millis / 1000
        val second = (totalSeconds % 60).toInt()
        val totalMinutes = totalSeconds / 60
        val minute = (totalMinutes % 60).toInt()
        val totalHours = totalMinutes / 60
        val hour = (totalHours % 24).toInt()
        var remainingDays = (totalHours / 24).toInt()

        var year = 1970
        while (true) {
            val daysInYear = if (isLeapYear(year)) 366 else 365
            if (remainingDays < daysInYear) break
            remainingDays -= daysInYear
            year++
        }

        val monthDays = intArrayOf(31, if (isLeapYear(year)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        var month = 0
        while (month < 12 && remainingDays >= monthDays[month]) {
            remainingDays -= monthDays[month]
            month++
        }
        val day = remainingDays + 1
        month += 1

        return "${year.pad(4)}-${month.pad(2)}-${day.pad(2)}T${hour.pad(2)}:${minute.pad(2)}:${second.pad(2)}Z"
    }

    private fun Int.pad(len: Int): String = this.toString().padStart(len, '0')

    private fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
