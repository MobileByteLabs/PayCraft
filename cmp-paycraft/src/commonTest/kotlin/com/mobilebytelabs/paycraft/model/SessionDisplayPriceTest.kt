package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.PriceDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * DR-5 regression lock — device-proven on CPH2423 / Android 15, 2026-09-05.
 *
 * PayCraft shipped a complete price resolver (native store price > cloud per-locale resolvedPrice >
 * tenant base price) with ZERO production call sites: all eight render sites read `basePrice`
 * directly. The paywall therefore rendered the tenant BASE price in `base_currency` (default USD)
 * no matter what the resolver decided — on device, "$9.99" while the SDK had resolved
 * country=IN currency=GBP.
 *
 * These tests pin the RESOLUTION half. The CALL-SITE half — "is the resolver actually invoked by
 * the UI" — cannot be asserted here, because a test of a function cannot detect that nobody calls
 * it; displayPrice()'s own unit tests passed throughout the entire period the paywall ignored it.
 * That half is held by G-PRICE-RENDER-RESOLVED (a source-level gate over call sites) plus its
 * red/green canary. Neither guard is sufficient alone — this file proves the arithmetic, the gate
 * proves the wiring.
 */
class SessionDisplayPriceTest {

    @AfterTest
    fun tearDown() {
        // The session is a singleton; leaving a suite behind would leak a GBP config into whatever
        // test runs next and make its base-price assertions fail for an unrelated reason.
        PayCraft.resetConfigStateForTesting()
    }

    private fun monthly(
        basePriceCents: Int = 999,
        baseCurrency: String = "USD",
        resolved: PriceDto? = null,
    ) = ProductDto(
        id = "p_monthly",
        sku = "pro_monthly",
        type = "subscription",
        displayName = "Pro Monthly",
        interval = "month",
        basePriceCents = basePriceCents,
        baseCurrency = baseCurrency,
        resolvedPrice = resolved,
    )

    private fun session(vararg products: ProductDto) {
        PayCraft.initialize(
            apiKey = "pk_test_session-display-price",
            backend = PayCraftBackend.Mock(
                staticConfig = SuiteConfig(tenantId = "t_dr5", products = products.toList()),
            ),
        )
    }

    @Test
    fun renders_the_cloud_resolved_price_not_the_base_price() {
        // The shipped defect in one assertion: base is USD 9.99, the cloud resolved GBP 7.92 for
        // this buyer's locale, and the paywall showed $9.99.
        val dto = monthly(resolved = PriceDto(amountCents = 792, currency = "GBP", source = "cloud"))
        session(dto)

        val product = ProductMapper.fromDto(dto)
        assertEquals(Money(792, "GBP"), product.sessionDisplayPrice())
        assertEquals("£7.92", product.sessionDisplayPriceFormatted())
    }

    @Test
    fun falls_back_to_the_base_price_when_the_cloud_resolved_nothing() {
        // The fallback must stay intact — a tenant with no per-locale pricing row still shows a
        // price rather than an empty string. This is the path every Roborazzi golden exercises,
        // which is precisely why 14 passing goldens never caught the defect above.
        val dto = monthly(resolved = null)
        session(dto)

        val product = ProductMapper.fromDto(dto)
        assertEquals(Money(999, "USD"), product.sessionDisplayPrice())
        assertEquals("$9.99", product.sessionDisplayPriceFormatted())
    }

    @Test
    fun falls_back_to_the_base_price_before_any_config_has_loaded() {
        // Cold start / offline first run: no suite in the session at all. A paywall composed here
        // must still render something.
        PayCraft.resetConfigStateForTesting()
        val product = ProductMapper.fromDto(monthly(resolved = PriceDto(792, "GBP", "cloud")))
        assertEquals(Money(999, "USD"), product.sessionDisplayPrice())
    }
}
