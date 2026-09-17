package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.platform.currentTimeMillis

object SyncPolicy {

    const val ONE_HOUR = 60 * 60 * 1000L
    const val ONE_DAY = 24 * ONE_HOUR
    const val ONE_WEEK = 7 * ONE_DAY

    fun isSyncDue(cached: SubscriptionStatus?, lastSyncedAt: Long): Boolean {
        if (cached == null || lastSyncedAt == 0L) return true

        // A cached premium whose expiry has already PASSED is confirmed with the server before the
        // interval would otherwise allow, because the interval is a bet on when something might
        // change and this is the case where it already has. Without this, a subscription that
        // lapsed twenty minutes ago keeps rendering Premium until the next scheduled sync.
        //
        // Note what this deliberately does NOT do: demote locally. The server decides entitlement;
        // this only forces the question to be asked. Optimistically revoking access on a clock the
        // device controls would take premium away from someone whose renewal simply has not landed
        // in the cache yet — a worse failure than briefly granting it.
        if (cached.isPremium) {
            val expiresAt = parseExpiryToMillis(cached.expiresAt)
            if (expiresAt != null && expiresAt <= currentTimeMillis()) return true
        }

        val elapsed = currentTimeMillis() - lastSyncedAt
        return elapsed >= syncInterval(cached)
    }

    fun syncInterval(status: SubscriptionStatus): Long {
        if (!status.isPremium) return ONE_DAY

        val expiresAt = parseExpiryToMillis(status.expiresAt) ?: return ONE_DAY
        val timeUntilExpiry = expiresAt - currentTimeMillis()

        val proximity = when {
            timeUntilExpiry <= ONE_DAY -> ONE_HOUR
            timeUntilExpiry <= ONE_WEEK -> ONE_DAY
            else -> ONE_WEEK
        }

        // A cancelled subscription is CEILINGED at daily, but still free to go hourly near expiry.
        //
        // `willRenew == false` used to short-circuit to ONE_DAY before the ladder ran at all, which
        // inverted the risk at the end: a sub cancelled and expiring in six hours was polled daily,
        // leaving premium live for up to ~18 hours past what the customer paid for. Deleting the
        // short-circuit outright is also wrong — it drops a cancelled sub 15 days out to WEEKLY, and
        // a cancellation can be reversed in the store, which the app should notice sooner than that.
        // So the ladder decides and cancellation caps it; s4 and s10 pin the two ends.
        return if (status.willRenew) proximity else minOf(ONE_DAY, proximity)
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
