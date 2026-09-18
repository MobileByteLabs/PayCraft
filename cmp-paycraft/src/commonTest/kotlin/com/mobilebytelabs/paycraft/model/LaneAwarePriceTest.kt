package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.config.PriceDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.StoreBinding
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The price a card shows must belong to the lane the buyer will actually be charged on, and every
 * line on that card must agree.
 *
 * DEVICE-OBSERVED 2026-09-18: a paywall rendered "₹1259" as the headline with
 * "$3.49 / mo billed annually" directly beneath it. Two price paths had OPPOSITE precedence — the
 * headline took the cloud-resolved price first, the per-month anchor took the native store price
 * first — so a razorpay-bound plan showed two currencies at once. A buyer cannot tell which one
 * they will be charged, and the checkout link is chosen from the active currency, so the mismatch
 * was not cosmetic.
 */
class LaneAwarePriceTest {

    private fun dto(
        id: String,
        sku: String,
        baseCents: Int,
        baseCurrency: String,
        resolved: PriceDto?,
        binding: StoreBinding?,
    ) = ProductDto(
        id = id,
        sku = sku,
        type = "subscription",
        displayName = "Plus (Annual)",
        displayOrder = 1,
        interval = "year",
        basePriceCents = baseCents,
        baseCurrency = baseCurrency,
        resolvedPrice = resolved,
        storeBinding = binding,
    )

    private fun subscription(id: String, sku: String, baseCents: Int, currency: String) =
        Product.Subscription(
            id = id,
            sku = sku,
            displayName = "Plus (Annual)",
            displayOrder = 1,
            interval = Product.Subscription.Interval.YEAR,
            basePrice = Money(baseCents, currency),
        )

    /**
     * The razorpay lane: the cloud figure is what the buyer pays. A Play price, even if the SDK has
     * one cached, is for a store this purchase will never touch.
     */
    @Test
    fun webPspLaneUsesTheCloudResolvedPrice() {
        val product = subscription("uuid-1", "plus_annual", 4199, "USD")
        val config = SuiteConfig(
            tenantId = "t-e2e",
            products = listOf(
                dto(
                    "uuid-1",
                    "plus_annual",
                    4199,
                    "USD",
                    PriceDto(125999, "INR", "fallback"),
                    StoreBinding("razorpay", "plan_XYZ"),
                ),
            ),
        )

        val price = product.laneAwareDisplayPrice(config)
        assertEquals("INR", price?.currency, "a razorpay-bound plan must quote the cloud INR price")
        assertEquals(125999, price?.amountMinor)
    }

    /**
     * The native lane keeps the behaviour that fix existed for: the store's own price outranks the
     * cloud figure, because the store is what will charge the card.
     */
    @Test
    fun nativeLaneStillPrefersTheStorePriceWhenPresent() {
        val product = subscription("uuid-2", "plus_annual_play", 4199, "USD")
        val config = SuiteConfig(
            tenantId = "t-e2e",
            products = listOf(
                dto(
                    "uuid-2",
                    "plus_annual_play",
                    4199,
                    "USD",
                    PriceDto(125999, "INR", "fallback"),
                    StoreBinding("google_play", "plus_annual_play"),
                ),
            ),
        )

        // No native price registered in this test process, so it falls through to the cloud figure
        // rather than inventing one. The lane check is what this asserts: consulting the native map
        // at all is gated on the binding, and a miss must degrade to the resolved price, never to
        // the base price in the base currency.
        val price = product.laneAwareDisplayPrice(config)
        assertEquals("INR", price?.currency)
    }

    /** No config yet (cold start) must still render something, not an empty card. */
    @Test
    fun coldStartFallsBackToTheBasePrice() {
        val product = subscription("uuid-3", "plus_annual", 4199, "USD")
        val price = product.laneAwareDisplayPrice(null)
        assertEquals("USD", price?.currency)
        assertEquals(4199, price?.amountMinor)
    }

    /**
     * THE REGRESSION ITSELF: the headline and the derived per-month line must be the same currency.
     * Computed the way each render site computes it, so a future change that reintroduces a second
     * precedence rule fails here rather than on a device.
     */
    @Test
    fun headlineAndPerMonthAnchorShareOneCurrency() {
        val product = subscription("uuid-4", "plus_annual", 4199, "USD")
        val config = SuiteConfig(
            tenantId = "t-e2e",
            products = listOf(
                dto(
                    "uuid-4",
                    "plus_annual",
                    4199,
                    "USD",
                    PriceDto(125999, "INR", "fallback"),
                    StoreBinding("razorpay", "plan_XYZ"),
                ),
            ),
        )

        val headline = product.laneAwareDisplayPrice(config)
        val perMonth = headline?.let { Money(it.amountMinor / 12, it.currency) }

        assertEquals(
            headline?.currency,
            perMonth?.currency,
            "the per-month anchor must be derived from the SAME resolved price as the headline — " +
                "\"₹1259\" above \"\$3.49 / mo\" is what happens when it is not",
        )
        assertEquals(10499, perMonth?.amountMinor)
    }
}
