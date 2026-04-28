package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.platform.currentTimeMillis

object SyncPolicy {

    const val ONE_HOUR = 60 * 60 * 1000L
    const val ONE_DAY = 24 * ONE_HOUR
    const val ONE_WEEK = 7 * ONE_DAY

    fun isSyncDue(cached: SubscriptionStatus?, lastSyncedAt: Long): Boolean {
        if (cached == null || lastSyncedAt == 0L) return true
        val elapsed = currentTimeMillis() - lastSyncedAt
        return elapsed >= syncInterval(cached)
    }

    fun syncInterval(status: SubscriptionStatus): Long {
        if (!status.isPremium) return ONE_DAY
        if (!status.willRenew) return ONE_DAY

        val expiresAt = parseExpiryToMillis(status.expiresAt) ?: return ONE_DAY
        val timeUntilExpiry = expiresAt - currentTimeMillis()

        return when {
            timeUntilExpiry <= ONE_DAY -> ONE_HOUR
            timeUntilExpiry <= ONE_WEEK -> ONE_DAY
            else -> ONE_WEEK
        }
    }

    /**
     * Manual ISO 8601 parser for fixed Supabase format: "YYYY-MM-DDTHH:MM:SSZ"
     * Returns epoch millis, or null if unparseable (falls back to daily sync).
     */
    internal fun parseExpiryToMillis(expiresAt: String?): Long? {
        if (expiresAt == null) return null
        return try {
            val clean = expiresAt.trimEnd('Z').removeSuffix("+00:00")
            val parts = clean.split('T')
            if (parts.size != 2) return null

            val dateParts = parts[0].split('-')
            val timeParts = parts[1].split(':')
            if (dateParts.size != 3 || timeParts.size != 3) return null

            val year = dateParts[0].toInt()
            val month = dateParts[1].toInt()
            val day = dateParts[2].toInt()
            val hour = timeParts[0].toInt()
            val minute = timeParts[1].toInt()
            val second = timeParts[2].split('.')[0].toInt()

            var days = 0L
            for (y in 1970 until year) {
                days += if (isLeapYear(y)) 366 else 365
            }
            val monthDays = intArrayOf(0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
            if (isLeapYear(year)) monthDays[2] = 29
            for (m in 1 until month) {
                days += monthDays[m]
            }
            days += (day - 1)

            (days * 86400 + hour * 3600 + minute * 60 + second) * 1000L
        } catch (_: Exception) {
            null
        }
    }

    private fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
