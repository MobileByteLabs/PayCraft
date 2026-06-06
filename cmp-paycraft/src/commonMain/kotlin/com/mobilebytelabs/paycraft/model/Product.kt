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
        enum class Interval { MONTH, QUARTER, SEMIANNUAL, YEAR }
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
        "month" -> Product.Subscription.Interval.MONTH
        "quarter" -> Product.Subscription.Interval.QUARTER
        "semiannual" -> Product.Subscription.Interval.SEMIANNUAL
        "year" -> Product.Subscription.Interval.YEAR
        else -> error("unknown subscription interval: $s")
    }
}
