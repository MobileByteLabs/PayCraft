package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * PB-4 / PB-5 — offer selection and product typing.
 *
 * The purchase path used to call `subscriptionOfferDetails.firstOrNull()`. Play returns every offer
 * the shopper is eligible for — base plan, free trial, intro price, developer offers — in an order
 * that carries no meaning, so which offer a buyer actually received was arbitrary. A free trial
 * configured in Play Console applied or didn't depending on the order Play happened to return, and
 * the advertised price came from whichever offer's first phase came back first.
 *
 * This is a revenue bug rather than a crash, which is exactly the kind that survives untested.
 */
class OfferSelectionTest {

    private fun phase(micros: Long, period: String = "P1M", cycles: Int = 0, formatted: String = "$9.99") =
        NativePricingPhase(
            priceAmountMicros = micros,
            formattedPrice = formatted,
            currencyCode = "USD",
            billingPeriodIso = period,
            billingCycleCount = cycles,
        )

    private fun offer(id: String, vararg phases: NativePricingPhase) =
        NativeOffer(offerToken = "token_$id", offerId = id, pricingPhases = phases.toList())

    private val basePlan = offer("base", phase(9_990_000))
    private val weekTrial = offer("trial7", phase(0, "P1W", 1, "Free"), phase(9_990_000))
    private val monthTrial = offer("trial30", phase(0, "P1M", 1, "Free"), phase(9_990_000))
    private val introPrice = offer("intro", phase(2_990_000, "P1M", 3, "$2.99"), phase(9_990_000))

    // ── PB-4: the trial must win, whatever order Play returns ────────────────

    @Test
    fun freeTrialBeatsBasePlan_regardlessOfOrder() {
        assertEquals(
            "trial7",
            selectBestOffer(listOf(basePlan, weekTrial))?.offerId,
            "A configured free trial must be the offer we purchase.",
        )
        assertEquals(
            "trial7",
            selectBestOffer(listOf(weekTrial, basePlan))?.offerId,
            "…and the answer must not depend on the order Play happened to return.",
        )
    }

    @Test
    fun longestFreeTrialWins() {
        assertEquals(
            "trial30",
            selectBestOffer(listOf(weekTrial, monthTrial, basePlan))?.offerId,
            "Between two trials the longer one is the stronger conversion lever.",
        )
    }

    @Test
    fun introPriceBeatsBasePlan_whenNoTrialExists() {
        assertEquals(
            "intro",
            selectBestOffer(listOf(basePlan, introPrice))?.offerId,
            "With no trial available, the cheapest first charge wins.",
        )
    }

    @Test
    fun trialBeatsIntroPrice() {
        assertEquals(
            "trial7",
            selectBestOffer(listOf(introPrice, weekTrial, basePlan))?.offerId,
            "Free beats cheap — a trial outranks a discounted intro price.",
        )
    }

    @Test
    fun selectionIsStableAcrossCalls() {
        val offers = listOf(basePlan, offer("a", phase(9_990_000)), offer("b", phase(9_990_000)))

        val first = selectBestOffer(offers)?.offerId
        val again = selectBestOffer(offers.reversed())?.offerId

        assertEquals(
            first,
            again,
            "Equally-ranked offers must tie-break deterministically, or the same shopper sees the " +
                "offer flicker between launches.",
        )
    }

    @Test
    fun noOffers_selectsNothing() {
        assertNull(selectBestOffer(emptyList()))
    }

    // ── The advertised price must be the recurring one, not the trial ────────

    @Test
    fun recurringPhaseSkipsFreePhases_soThePaywallNeverAdvertisesFree() {
        assertEquals(
            9_990_000,
            weekTrial.recurringPhase?.priceAmountMicros,
            "Quoting the trial's zero-price phase would render the plan's price as 'Free'.",
        )
    }

    @Test
    fun freeTrialDaysSumsTheLeadingFreePhases() {
        assertEquals(7, weekTrial.freeTrialDays)
        assertEquals(30, monthTrial.freeTrialDays)
        assertEquals(0, basePlan.freeTrialDays, "A base plan has no trial.")
        assertEquals(0, introPrice.freeTrialDays, "A discounted intro price is not a free trial.")
    }

    // ── ISO period parsing ───────────────────────────────────────────────────

    @Test
    fun isoPeriodsParseToDays() {
        assertEquals(3, isoPeriodToDays("P3D"))
        assertEquals(7, isoPeriodToDays("P1W"))
        assertEquals(30, isoPeriodToDays("P1M"))
        assertEquals(180, isoPeriodToDays("P6M"))
        assertEquals(365, isoPeriodToDays("P1Y"))
    }

    @Test
    fun unparseablePeriodIsZeroNotACrash() {
        assertEquals(0, isoPeriodToDays(""))
        assertEquals(0, isoPeriodToDays("garbage"))
        assertEquals(0, isoPeriodToDays("P"))
        assertTrue(isoPeriodToDays("PT30M") == 0, "Time components are not billing periods.")
    }

    // ── PB-5: lifetime plans are ONE_TIME, not SUBS ──────────────────────────

    private fun plan(interval: String) = BillingPlan(
        id = "p",
        name = "Plan",
        price = "$9.99",
        interval = interval,
        rank = 0,
    )

    @Test
    fun lifetimePlanIsAOneTimeProduct() {
        assertEquals(
            NativeProductType.ONE_TIME,
            plan("lifetime").nativeProductType,
            "A lifetime plan is an INAPP product. Asking Play for it as SUBS is why it rendered, " +
                "was tappable, and failed with 'Product not found on Play'.",
        )
        assertEquals(NativeProductType.ONE_TIME, plan("LIFETIME").nativeProductType)
    }

    @Test
    fun recurringPlansAreSubscriptions() {
        listOf("month", "quarter", "6mo", "year").forEach {
            assertEquals(
                NativeProductType.SUBSCRIPTION,
                plan(it).nativeProductType,
                "'$it' is a recurring plan.",
            )
        }
    }
}
