package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.config.ProductDto

/**
 * Sealed product hierarchy — matches cloud `tenant_products.type` enum 1:1.
 *
 * Cloud-side three types (subscription / trial / lifetime) are mapped 1:1 into this
 * sealed class via [ProductMapper]. UI templates render distinct cards per branch.
 */
sealed class Product {
    abstract val id: String
    abstract val sku: String
    abstract val displayName: String
    abstract val displayOrder: Int

    data class Subscription(
        override val id: String,
        override val sku: String,
        override val displayName: String,
        override val displayOrder: Int,
        val interval: Interval,
        val basePrice: Money,
    ) : Product() {
        /**
         * Billing cadence. WEEK was added 2026-10-09 with the default catalogue
         * (week/month/quarter/year). SEMIANNUAL stays: it is no longer seeded by default but
         * remains storable server-side and tenants still sell it.
         *
         * Every `when` over this enum is exhaustive WITHOUT an `else` on purpose — that is what
         * makes the compiler name each display site when a cadence is added, instead of a new
         * interval silently rendering as whatever the fallback arm said.
         */
        enum class Interval { WEEK, MONTH, QUARTER, SEMIANNUAL, YEAR }
    }

    data class Trial(
        override val id: String,
        override val sku: String,
        override val displayName: String,
        override val displayOrder: Int,
        val durationDays: Int,
        val attachesToProductId: String?,
    ) : Product()

    data class Lifetime(
        override val id: String,
        override val sku: String,
        override val displayName: String,
        override val displayOrder: Int,
        val basePrice: Money,
    ) : Product()
}

/** Maps the cloud-fetched [ProductDto] into the SDK sealed [Product] hierarchy. */
object ProductMapper {
    fun fromDto(dto: ProductDto): Product = when (dto.type) {
        "subscription" -> Product.Subscription(
            id = dto.id,
            sku = dto.sku,
            displayName = dto.displayName,
            displayOrder = dto.displayOrder,
            interval = parseInterval(dto.interval),
            basePrice = Money(dto.basePriceCents, dto.baseCurrency),
        )
        "trial" -> Product.Trial(
            id = dto.id,
            sku = dto.sku,
            displayName = dto.displayName,
            displayOrder = dto.displayOrder,
            durationDays = dto.trialDurationDays
                ?: error("trial product '${dto.id}' missing trial_duration_days"),
            attachesToProductId = dto.attachesToProductId,
        )
        "lifetime" -> Product.Lifetime(
            id = dto.id,
            sku = dto.sku,
            displayName = dto.displayName,
            displayOrder = dto.displayOrder,
            basePrice = Money(dto.basePriceCents, dto.baseCurrency),
        )
        else -> error("unknown product type: ${dto.type}")
    }

    private fun parseInterval(s: String?): Product.Subscription.Interval = when (s) {
        // The server's interval vocabulary, mirrored. This is the FIRST thing a weekly product
        // meets: without a "week" arm the `else` below aborts config parsing with
        // "unknown subscription interval: week", so the paywall shows nothing at all. Erroring is
        // the right failure for an unknown cadence — a silent fallback to MONTH would bill a
        // weekly subscriber monthly — but a cadence the server can legitimately send must be here.
        "week" -> Product.Subscription.Interval.WEEK
        "month" -> Product.Subscription.Interval.MONTH
        "quarter" -> Product.Subscription.Interval.QUARTER
        "semiannual" -> Product.Subscription.Interval.SEMIANNUAL
        "year" -> Product.Subscription.Interval.YEAR
        else -> error("unknown subscription interval: $s")
    }
}
