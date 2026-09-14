package com.mobilebytelabs.paycraft.presentation.tree

import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product

/**
 * Per-month equivalent for a non-monthly subscription, e.g. "$3.49 / mo billed annually".
 *
 * Returns null for monthly and non-subscription products — there is nothing to restate, and a
 * redundant "per month" line under a monthly price reads as a second, different price.
 */
internal fun Product.monthlyEquivalentNote(): String? {
    val sub = this as? Product.Subscription ?: return null
    val months = when (sub.interval) {
        Product.Subscription.Interval.YEAR -> 12
        Product.Subscription.Interval.SEMIANNUAL -> 6
        Product.Subscription.Interval.QUARTER -> 3
        Product.Subscription.Interval.MONTH -> return null
    }
    val per = Money(sub.basePrice.amountMinor / months, sub.basePrice.currency)
    // "yearly" is what `Interval.YEAR.name.lowercase() + "ly"` produces; the templates say
    // "annually". Spelled out rather than derived so the two renderers read identically.
    val cadence = when (sub.interval) {
        Product.Subscription.Interval.YEAR -> "annually"
        Product.Subscription.Interval.SEMIANNUAL -> "semiannually"
        Product.Subscription.Interval.QUARTER -> "quarterly"
        Product.Subscription.Interval.MONTH -> return null
    }
    return "${per.format()} / mo billed $cadence"
}

/**
 * Discount against the monthly plan, as a whole percent, or null when there is no honest saving.
 *
 * Null rather than 0 when the comparison cannot be made (no monthly plan, zero price, a longer plan
 * that is not actually cheaper): a "SAVE 0%" chip is worse than no chip, and a chip on a plan that
 * costs MORE per month would be a false claim on a payment surface.
 */
internal fun Product.savingsVersusMonthly(all: List<Product>): Int? {
    val sub = this as? Product.Subscription ?: return null
    if (sub.interval == Product.Subscription.Interval.MONTH) return null
    val monthly = all.filterIsInstance<Product.Subscription>()
        .firstOrNull { it.interval == Product.Subscription.Interval.MONTH } ?: return null
    if (monthly.basePrice.amountMinor <= 0) return null

    val months = when (sub.interval) {
        Product.Subscription.Interval.YEAR -> 12
        Product.Subscription.Interval.SEMIANNUAL -> 6
        Product.Subscription.Interval.QUARTER -> 3
        Product.Subscription.Interval.MONTH -> return null
    }
    val fullPrice = monthly.basePrice.amountMinor * months
    if (sub.basePrice.amountMinor >= fullPrice) return null
    val pct = ((fullPrice - sub.basePrice.amountMinor) * 100.0 / fullPrice)
    // ROUND, do not truncate. $41.99/yr against $6.99/mo is 49.94%, which `toInt()` reports as
    // "SAVE 49%" while the template says 50% — the same catalogue described two ways depending on
    // which renderer drew it. Truncation also always understates the offer, so the tree would
    // consistently undersell the annual plan against its own marketing.
    return kotlin.math.round(pct).toInt().takeIf { it > 0 }
}
