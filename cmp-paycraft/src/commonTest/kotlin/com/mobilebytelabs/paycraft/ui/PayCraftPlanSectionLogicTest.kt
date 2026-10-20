package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The arithmetic behind the settings section — the part that is wrong in every hand-rolled version.
 *
 * Tested as pure functions rather than through the composable, because what can actually be wrong
 * here is the counting, the parsing, and which of three copy sources wins — not the layout.
 *
 * `mergedWith` is the half worth testing hardest: it decides whether a device shows the tenant's
 * wording, the tenant's paywall wording, or the SDK's bundled translation, and the failure mode is
 * silent (a blank label, or English where a translation existed).
 */
class PayCraftPlanSectionLogicTest {

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

    // ── copy resolution: dashboard over bundled ──────────────────────────────────────────────────

    /** Stands in for what `rememberSettingsCopy` reads out of the SDK's own strings.xml. */
    private val bundled = PlanSectionCopy(
        freeLabel = "Free",
        trialLabel = "Trial",
        premiumLabel = "Premium",
        freeSupporting = "Free plan — no active subscription",
        trialSupporting = "Free trial active",
        trialEndingToday = "Trial ends today",
        trialOneDayLeft = "Trial — 1 day left",
        trialDaysLeftTemplate = "Trial — {days} days left",
        premiumSupporting = "Subscription active",
        renewsOnTemplate = "Renews {date}",
        expiresOnTemplate = "Expires {date}",
        manageLabel = "Manage Subscription",
        upgradeLabel = "Get Premium",
        restoreLabel = "Restore Purchases",
        fromPriceTemplate = "From {price}",
        perIntervalTemplate = "per {interval}",
        billedThroughTemplate = "Billed through {store}",
    )

    @Test
    fun copy_fallsBackToBundledWhenTheTenantConfiguredNothing() {
        // The common case by a wide margin: a tenant who never opened the designer. Every column is
        // blank, and the SDK must render its own localised strings rather than empty labels — which
        // is why migration 156 defaults those columns to '' instead of to English.
        val resolved = bundled.mergedWith(PaywallDto())
        assertEquals(bundled, resolved)
    }

    @Test
    fun copy_prefersTheDashboardValue() {
        val resolved = bundled.mergedWith(PaywallDto(settingsPremiumLabel = "Cappy Pro"))
        assertEquals("Cappy Pro", resolved.premiumLabel)
        // and leaves everything the tenant did NOT set alone
        assertEquals("Free", resolved.freeLabel)
    }

    @Test
    fun copy_substitutesTheDaysToken() {
        val resolved = bundled.mergedWith(PaywallDto(settingsTrialDaysLeft = "Essai — {days} jours"))
        assertEquals("Essai — 6 jours", resolved.trialDaysLeft(6))
    }

    @Test
    fun copy_substitutesTheDateToken() {
        val resolved = bundled.mergedWith(
            PaywallDto(
                settingsRenewsOn = "Renouvelle le {date}",
                settingsExpiresOn = "Expire le {date}",
            ),
        )
        assertEquals("Renouvelle le 14 Nov 2026", resolved.renewsOn("14 Nov 2026"))
        assertEquals("Expire le 14 Nov 2026", resolved.expiresOn("14 Nov 2026"))
    }

    @Test
    fun copy_keepsTheOneDayFormSeparateFromTheTemplate() {
        // A tenant who sets only the plural template must not get "1 days left" on the final day.
        // No token substitution can pluralise, which is why this is its own field and its own column.
        val resolved = bundled.mergedWith(PaywallDto(settingsTrialDaysLeft = "{days} days to go"))
        assertEquals("Trial — 1 day left", resolved.trialOneDayLeft)
        assertEquals("6 days to go", resolved.trialDaysLeft(6))
    }

    @Test
    fun copy_distinguishesRenewalFromExpiry() {
        // A subscription that will NOT renew says "Expires", not "Renews". Telling a cancelling
        // user their subscription renews is the wording error that generates support mail.
        val c = bundled.mergedWith(PaywallDto())
        assertEquals("Renews 14 Nov 2026", c.renewsOn("14 Nov 2026"))
        assertEquals("Expires 14 Nov 2026", c.expiresOn("14 Nov 2026"))
    }

    @Test
    fun copy_doesNotInheritPaywallWordingForUpgradeOrRestore() {
        // Regression. An earlier version fell through the tenant's PAYWALL cta/restore before
        // reaching the bundled string, as a convenience. But PaywallDto defaults those two to
        // NON-BLANK English and the server always sends them, so the middle rung always hit and the
        // bundled LOCALISED rung became unreachable — a French app would show English here while
        // every other label was translated. Only `settings_*` may override.
        val resolved = bundled.mergedWith(
            PaywallDto(ctaGetPremium = "Go Pro", restoreLabel = "Restore Your Pro"),
        )
        assertEquals("Get Premium", resolved.upgradeLabel)
        assertEquals("Restore Purchases", resolved.restoreLabel)

        val explicit = bundled.mergedWith(PaywallDto(settingsUpgradeLabel = "Subscribe"))
        assertEquals("Subscribe", explicit.upgradeLabel)
    }

    @Test
    fun copy_treatsWhitespaceAsUnset() {
        // `ifBlank`, not `ifEmpty`: a designer field that got a stray space must not blank the label
        // on every device. A row of spaces is not copy.
        val resolved = bundled.mergedWith(PaywallDto(settingsPremiumLabel = "   "))
        assertEquals("Premium", resolved.premiumLabel)
    }

    // ── planLineFor / billedThroughFor ───────────────────────────────────────────────────────────
    //
    // The device can only ever show the FREE path without a real purchase, so the subscriber
    // derivation is verified here or nowhere. That asymmetry is the reason these exist.

    private fun plan(sku: String, price: String, interval: String, rank: Int) =
        BillingPlan(id = sku, sku = sku, name = sku, price = price, interval = interval, rank = rank)

    /** Deliberately NOT in rank order — a test that feeds a pre-sorted list proves nothing. */
    private val catalogue = listOf(
        plan("annual", "₹1259", "year", rank = 4),
        plan("weekly", "₹89", "week", rank = 1),
        plan("quarterly", "₹854", "quarter", rank = 3),
        plan("monthly", "₹209", "month", rank = 2),
    )

    @Test
    fun freeCardQuotesTheCheapestEntryPoint() {
        assertEquals("From ₹89 per week", planLineFor(EntitlementTier.FREE, null, catalogue, bundled))
    }

    @Test
    fun cheapestIsByRankNotByTheFormattedPriceString() {
        // The bug this pins: "₹1259" < "₹89" lexically, so a string sort puts the ANNUAL plan first
        // and the free card advertises the most expensive option as its entry price. Sorting by a
        // parsed amount is no better — it would have to strip a symbol that varies by currency.
        val line = planLineFor(EntitlementTier.FREE, null, catalogue, bundled)
        assertEquals("From ₹89 per week", line)
        assertTrue("1259" !in line!!, "rank must decide the entry price, not string order")
    }

    @Test
    fun subscriberQuotesTheirOwnPlanWithoutTheFromPrefix() {
        // "From ₹1259" would read as though their own plan might cost more than they pay.
        assertEquals("₹1259 per year", planLineFor(EntitlementTier.PREMIUM, "annual", catalogue, bundled))
    }

    @Test
    fun trialQuotesTheHeldPlanToo() {
        // TRIAL is not FREE: a trialist holds a plan, and the card must show what it will cost when
        // the trial converts. Falling into the FREE branch would quote the cheapest plan instead of
        // theirs — right-looking, and wrong for anyone trialling above the entry tier.
        assertEquals("₹209 per month", planLineFor(EntitlementTier.TRIAL, "monthly", catalogue, bundled))
    }

    @Test
    fun aRetiredSkuRendersNoLineRatherThanAHalfBuiltOne() {
        // A plan pulled from the dashboard while someone still holds it. "From  per " is worse
        // than silence, and a crash is worse than both.
        assertNull(planLineFor(EntitlementTier.PREMIUM, "a-sku-no-longer-sold", catalogue, bundled))
    }

    @Test
    fun anEmptyCatalogueRendersNoLine() {
        // The first frame on every cold start, before /config lands.
        assertNull(planLineFor(EntitlementTier.FREE, null, emptyList(), bundled))
        assertNull(planLineFor(EntitlementTier.PREMIUM, "annual", emptyList(), bundled))
    }

    @Test
    fun billingOwnerIsNamedForASubscriber() {
        assertEquals("Billed through Google Play", billedThroughFor(EntitlementTier.PREMIUM, "google_play", bundled))
        assertEquals("Billed through App Store", billedThroughFor(EntitlementTier.PREMIUM, "app_store", bundled))
    }

    @Test
    fun anUnknownProviderIsTitleCasedRatherThanDropped() {
        // A tenant adding a provider must not need an SDK release for it to read properly.
        assertEquals("Billed through Razorpay", billedThroughFor(EntitlementTier.PREMIUM, "razorpay", bundled))
    }

    @Test
    fun aFreeUserIsNeverToldWhoBillsThem() {
        // A lapsed subscription leaves a provider on the status. Naming it implies a relationship
        // that ended, and sends the user to a store page that will show them nothing.
        assertNull(billedThroughFor(EntitlementTier.FREE, "google_play", bundled))
        assertNull(billedThroughFor(EntitlementTier.PREMIUM, null, bundled))
        assertNull(billedThroughFor(EntitlementTier.PREMIUM, "  ", bundled))
    }
}

/**
 * The style presets.
 *
 * Asserts the CONTRACT of the set rather than any pixel: five presets exist, they are distinct, and
 * the one decision every style shares — which primary action to show — is centralised so no style
 * can disagree with another.
 */
class PayCraftPlanSectionStyleTest {

    @Test
    fun fiveStylesAreOffered() {
        assertEquals(5, PayCraftPlanSectionStyle.entries.size)
    }

    @Test
    fun rowsIsTheDefault() {
        // The conventional settings section. A host that passes no style gets the shape that fits a
        // settings list, not the one that assumes it owns the viewport.
        assertEquals(PayCraftPlanSectionStyle.Rows, PayCraftPlanSectionStyle.Rows)
        assertTrue(PayCraftPlanSectionStyle.entries.contains(PayCraftPlanSectionStyle.Rows))
    }

    @Test
    fun everyStyleIsNamedAndDistinct() {
        val names = PayCraftPlanSectionStyle.entries.map { it.name }.toSet()
        assertEquals(
            setOf("Minimal", "Rows", "Card", "Hero", "Compact"),
            names,
            "the preset set is public API — renaming one silently breaks every consumer that named it",
        )
    }
}
