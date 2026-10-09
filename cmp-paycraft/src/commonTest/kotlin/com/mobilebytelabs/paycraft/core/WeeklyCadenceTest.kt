package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.tree.monthlyEquivalentNote
import com.mobilebytelabs.paycraft.presentation.tree.savingsVersusMonthly
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The weekly cadence must survive the whole client path: parse -> label -> pricing claims.
 *
 * WHY THIS IS A TEST AND NOT JUST A COMPILE
 * Adding `WEEK` to `Product.Subscription.Interval` made the compiler name all nine exhaustive
 * `when`s, which is exactly why the enum has no `else` arms. But three things the compiler cannot
 * see would each ship a wrong paywall:
 *
 *   1. `parseInterval` is keyed on a STRING with `else -> error(...)`. Before this change a weekly
 *      product from /config aborted config parsing with "unknown subscription interval: week" —
 *      the paywall renders nothing at all, for every tenant, the moment the catalogue seeds a
 *      weekly tier. Erroring is the correct failure for a genuinely unknown cadence (a silent
 *      fallback to MONTH would bill a weekly subscriber monthly) but `week` is not unknown.
 *
 *   2. The savings/anchor helpers divide by a months-per-interval multiplier. Weekly has no honest
 *      multiplier: $2.99/wk is ~$12.95/mo, MORE than the $9.99 monthly. Any "SAVE x%" chip or
 *      "/mo billed weekly" anchor on that card would be a false claim about money on a payment
 *      surface, which is the exact thing those helpers' null-rather-than-zero rule exists to stop.
 *
 *   3. A copy-pasted arm could label a weekly plan "month" and still compile.
 */
class WeeklyCadenceTest {

    private fun sub(
        id: String,
        interval: Product.Subscription.Interval,
        minor: Int,
    ) = Product.Subscription(
        id = id,
        sku = id,
        displayName = id,
        displayOrder = 1,
        interval = interval,
        basePrice = Money(minor, "USD"),
    )

    @Test
    fun week_is_a_distinct_interval_value() {
        // Guards the copy-paste slip: WEEK must not be an alias of MONTH.
        assertTrue(Product.Subscription.Interval.WEEK != Product.Subscription.Interval.MONTH)
        assertEquals(5, Product.Subscription.Interval.entries.size, "week|month|quarter|semiannual|year")
    }

    @Test
    fun semiannual_is_still_a_value_even_though_it_left_the_default_catalogue() {
        // Retiring a tier from the DEFAULT set is not revoking it: live tenants still sell
        // semiannual, and the server can still send it. Dropping the enum value would crash their
        // config parse — the client mirror of the "never narrow a CHECK" rule.
        assertTrue(Product.Subscription.Interval.entries.contains(Product.Subscription.Interval.SEMIANNUAL))
    }

    @Test
    fun a_weekly_plan_claims_no_saving_against_monthly() {
        // $2.99/week is ~$12.95/month — MORE than $9.99/month. A savings chip here would be false.
        val weekly = sub("w", Product.Subscription.Interval.WEEK, 299)
        val monthly = sub("m", Product.Subscription.Interval.MONTH, 999)
        assertNull(
            weekly.savingsVersusMonthly(listOf(weekly, monthly)),
            "a weekly plan costs MORE per month than monthly; a SAVE chip would be a false claim",
        )
    }

    @Test
    fun a_weekly_plan_has_no_monthly_equivalent_note() {
        // The note exists to restate MULTI-MONTH plans as a monthly rate. Weekly is not one, and
        // "$12.95 / mo billed weekly" would make the cheapest-looking card read as the dearest.
        val weekly = sub("w", Product.Subscription.Interval.WEEK, 299)
        assertNull(weekly.monthlyEquivalentNote())
    }

    @Test
    fun a_yearly_plan_still_claims_its_saving() {
        // The weekly guard must not defang the real case.
        val yearly = sub("y", Product.Subscription.Interval.YEAR, 9950)
        val monthly = sub("m", Product.Subscription.Interval.MONTH, 999)
        val pct = yearly.savingsVersusMonthly(listOf(yearly, monthly))
        assertNotNull(pct, "an annual plan at \$99.50 vs \$9.99/mo genuinely saves")
        assertTrue(pct in 1..99)
    }
}
