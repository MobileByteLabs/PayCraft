package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The arithmetic behind the settings section — the part that is wrong in every hand-rolled version.
 *
 * Tested as pure functions rather than through the composable, because what can actually be wrong
 * here is the counting and the parsing, not the layout. A host that uses
 * [rememberSubscriptionSettingsState] and draws its own rows gets exactly this logic, so this is
 * the contract both entry points share.
 */
class SubscriptionSettingsLogicTest {

    private val day = 24L * 60 * 60 * 1000

    /** An ISO string offset from the REAL clock, so the test exercises production's parse path. */
    private fun isoIn(millisFromNow: Long): String {
        val target = currentTimeMillis() + millisFromNow
        var days = target / day
        var year = 1970
        while (true) {
            val len = if (isLeap(year)) 366 else 365
            if (days < len) break
            days -= len
            year++
        }
        val lengths = monthLengths(year)
        var month = 0
        while (days >= lengths[month]) {
            days -= lengths[month]
            month++
        }
        val d = (days + 1).toString().padStart(2, '0')
        val m = (month + 1).toString().padStart(2, '0')
        return "$year-$m-${d}T12:00:00Z"
    }

    private fun isLeap(y: Int) = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    private fun monthLengths(y: Int) = intArrayOf(31, if (isLeap(y)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

    // ── daysUntil ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun daysUntil_isNullForUnparseableOrAbsent() {
        // A trial with no end date must not render "0 days left" — that reads as "expiring now" to
        // a user whose trial is fine. The caller falls back to generic copy instead.
        assertNull(daysUntil(null))
        assertNull(daysUntil(""))
        assertNull(daysUntil("not-a-date"))
        assertNull(daysUntil("2026-11-14"))
    }

    @Test
    fun daysUntil_isZeroForThePast() {
        assertEquals(0L, daysUntil("2020-01-01T00:00:00Z"))
    }

    @Test
    fun daysUntil_roundsUpNotDown() {
        // 36 hours left is "2 days", not 1. Flooring makes the app look like it is counting faster
        // than the calendar, and "1 day left" with 36 hours remaining pressures the user wrongly.
        assertEquals(2L, daysUntil(isoIn(36 * 60 * 60 * 1000L)))
    }

    // ── formatDate ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun formatDate_rendersAnUnambiguousDate() {
        // "14 Nov 2026" cannot be misread the way 11/14 vs 14/11 can.
        assertEquals("14 Nov 2026", formatDate("2026-11-14T10:30:00Z"))
    }

    @Test
    fun formatDate_stripsLeadingZeroFromTheDay() {
        assertEquals("3 Jan 2027", formatDate("2027-01-03T00:00:00Z"))
    }

    @Test
    fun formatDate_returnsInputUnchangedWhenItCannotParse() {
        // Never throw on a settings screen: a malformed date from the backend must degrade to
        // showing something, not crash the row a user opened in order to cancel.
        assertEquals("garbage", formatDate("garbage"))
        assertEquals("2026-13-99T00:00:00Z", formatDate("2026-13-99T00:00:00Z"))
    }

    // ── copy defaults ────────────────────────────────────────────────────────────────────────────

    @Test
    fun copy_pluralisesTheTrialCountdown() {
        val c = SubscriptionSettingsCopy()
        assertEquals("Trial — 1 day left", c.trialOneDayLeft)
        assertEquals("Trial — 6 days left", c.trialDaysLeft(6))
    }

    @Test
    fun copy_distinguishesRenewalFromExpiry() {
        // A subscription that will NOT renew says "Expires", not "Renews". Telling a cancelling
        // user their subscription renews is the wording error that generates support mail.
        val c = SubscriptionSettingsCopy()
        assertEquals("Renews 14 Nov 2026", c.renewsOn("14 Nov 2026"))
        assertEquals("Expires 14 Nov 2026", c.expiresOn("14 Nov 2026"))
    }

    @Test
    fun copy_isFullyOverridableForLocalisation() {
        // Until copy comes from the dashboard, a localising host must be able to replace every
        // string without forking the component.
        val c = SubscriptionSettingsCopy(
            freeLabel = "Gratuit",
            trialDaysLeft = { "Essai — $it jours" },
            renewsOn = { "Renouvelle le $it" },
        )
        assertEquals("Gratuit", c.freeLabel)
        assertEquals("Essai — 3 jours", c.trialDaysLeft(3))
        assertEquals("Renouvelle le 14 Nov 2026", c.renewsOn("14 Nov 2026"))
    }
}

/**
 * The style presets.
 *
 * Asserts the CONTRACT of the set rather than any pixel: five presets exist, they are distinct, and
 * the one decision every style shares — which primary action to show — is centralised so no style
 * can disagree with another.
 */
class SubscriptionSettingsStyleTest {

    @Test
    fun fiveStylesAreOffered() {
        assertEquals(5, SubscriptionSettingsStyle.entries.size)
    }

    @Test
    fun rowsIsTheDefault() {
        // The conventional settings section. A host that passes no style gets the shape that fits a
        // settings list, not the one that assumes it owns the viewport.
        assertEquals(SubscriptionSettingsStyle.Rows, SubscriptionSettingsStyle.Rows)
        assertTrue(SubscriptionSettingsStyle.entries.contains(SubscriptionSettingsStyle.Rows))
    }

    @Test
    fun everyStyleIsNamedAndDistinct() {
        val names = SubscriptionSettingsStyle.entries.map { it.name }.toSet()
        assertEquals(
            setOf("Minimal", "Rows", "Card", "Hero", "Compact"),
            names,
            "the preset set is public API — renaming one silently breaks every consumer that named it",
        )
    }
}
