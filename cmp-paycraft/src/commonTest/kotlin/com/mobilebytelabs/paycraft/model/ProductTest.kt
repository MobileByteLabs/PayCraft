package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.config.ProductDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertIs
import kotlin.test.assertNull

class ProductTest {

    @Test
    fun mapper_returns_Subscription_for_subscription_type() {
        val dto = ProductDto(
            id = "p1",
            sku = "sub-monthly",
            type = "subscription",
            displayName = "Monthly",
            interval = "month",
            basePriceCents = 999,
            baseCurrency = "USD",
            displayOrder = 0,
        )
        val product = ProductMapper.fromDto(dto)
        val subscription = assertIs<Product.Subscription>(product)
        assertEquals("p1", subscription.id)
        assertEquals(Product.Subscription.Interval.MONTH, subscription.interval)
        assertEquals(Money(999, "USD"), subscription.basePrice)
    }

    @Test
    fun mapper_returns_Trial_for_trial_type() {
        val dto = ProductDto(
            id = "p2",
            sku = "trial-7d",
            type = "trial",
            displayName = "7-day Free Trial",
            trialDurationDays = 7,
            attachesToProductId = "p1",
            displayOrder = 1,
        )
        val product = ProductMapper.fromDto(dto)
        val trial = assertIs<Product.Trial>(product)
        assertEquals(7, trial.durationDays)
        assertEquals("p1", trial.attachesToProductId)
    }

    @Test
    fun mapper_returns_Lifetime_for_lifetime_type() {
        val dto = ProductDto(
            id = "p3",
            sku = "lifetime",
            type = "lifetime",
            displayName = "Lifetime",
            basePriceCents = 4999,
            baseCurrency = "USD",
            displayOrder = 2,
        )
        val product = ProductMapper.fromDto(dto)
        val lifetime = assertIs<Product.Lifetime>(product)
        assertEquals(Money(4999, "USD"), lifetime.basePrice)
    }

    @Test
    fun mapper_throws_on_unknown_type() {
        val dto = ProductDto(
            id = "px",
            sku = "px",
            type = "addon",
            displayName = "Addon",
        )
        assertFails { ProductMapper.fromDto(dto) }
    }

    @Test
    fun mapper_throws_when_trial_missing_duration() {
        val dto = ProductDto(
            id = "p2",
            sku = "trial",
            type = "trial",
            displayName = "Trial",
            trialDurationDays = null,
        )
        assertFails { ProductMapper.fromDto(dto) }
    }

    @Test
    fun mapper_parses_all_intervals() {
        val variants = mapOf(
            "month" to Product.Subscription.Interval.MONTH,
            "quarter" to Product.Subscription.Interval.QUARTER,
            "semiannual" to Product.Subscription.Interval.SEMIANNUAL,
            "year" to Product.Subscription.Interval.YEAR,
        )
        variants.forEach { (interval, expected) ->
            val dto = ProductDto(
                id = "p-$interval",
                sku = "sku-$interval",
                type = "subscription",
                displayName = "Plan",
                interval = interval,
                basePriceCents = 100,
                baseCurrency = "USD",
            )
            val sub = assertIs<Product.Subscription>(ProductMapper.fromDto(dto))
            assertEquals(expected, sub.interval)
        }
    }

    @Test
    fun money_format_handles_currencies() {
        assertEquals("$9.99", Money(999, "USD").format())
        assertEquals("€10.00", Money(1000, "EUR").format())
        assertEquals("£0.50", Money(50, "GBP").format())
        assertEquals("₹49", Money(4900, "INR").format())
        assertEquals("JPY 100.00", Money(10000, "JPY").format())
    }

    @Test
    fun trial_displayPrice_is_null() {
        val trial = Product.Trial(
            id = "p2",
            sku = "trial",
            displayName = "Trial",
            displayOrder = 0,
            durationDays = 7,
            attachesToProductId = null,
        )
        // SuiteConfig with no products → trial still returns null per contract
        val config = com.mobilebytelabs.paycraft.config.SuiteConfig(tenantId = "t1")
        assertNull(trial.displayPrice(config))
    }
}
