package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.config.productForRole
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The gap that only a real consumer app could show.
 *
 * Offerings are new. A tenant onboarded before them has products and no `tenant_packages` rows, so
 * every role resolved to null — and once the component tree became the render path for everyone
 * (D3), that produced a paywall with a headline, a CTA and NOTHING TO BUY. cappy, running against
 * the production backend, rendered exactly that. No unit test, golden or sample app could see it:
 * they all supply offerings.
 */
class CanonicalRoleFallbackTest {

    private fun sub(sku: String, interval: String) = ProductDto(
        id = "id_$sku", sku = sku, type = "subscription",
        displayName = sku, interval = interval, basePriceCents = 100,
    )

    private val legacyTenant = SuiteConfig(
        tenantId = "legacy",
        products = listOf(
            sub("yearly_v2", "year"),
            sub("monthly_v2", "month"),
            ProductDto(id = "id_life", sku = "forever", type = "lifetime", displayName = "Lifetime"),
        ),
        // No offerings at all — the shape every pre-offerings tenant is in.
    )

    @Test
    fun canonical_roles_resolve_with_no_offerings_configured() {
        assertEquals("yearly_v2", legacyTenant.productForRole("\$rc_annual")?.sku)
        assertEquals("monthly_v2", legacyTenant.productForRole("\$rc_monthly")?.sku)
        assertEquals("forever", legacyTenant.productForRole("\$rc_lifetime")?.sku)
    }

    /**
     * cappy's real catalogue: TWO monthly products. Taken from the live dashboard, not invented —
     * "Cappy Plus (Monthly)" $6.99 at order 2 and "Warm Springs Guardian" $7.99 at order 3. Which
     * one `${'$'}rc_monthly` resolves to decides what a customer is charged, so it must not depend
     * on the order the catalogue happened to arrive in.
     */
    @Test
    fun with_two_products_of_one_interval_display_order_decides() {
        val twoMonthlies = SuiteConfig(
            tenantId = "cappy",
            products = listOf(
                // Deliberately supplied in the WRONG order to prove list position does not win.
                sub("cappy_plus_guardian", "month").copy(displayOrder = 3, basePriceCents = 799),
                sub("cappy_plus_monthly", "month").copy(displayOrder = 2, basePriceCents = 699),
                sub("cappy_plus_annual", "year").copy(displayOrder = 1, basePriceCents = 4199),
            ),
        )
        assertEquals("cappy_plus_monthly", twoMonthlies.productForRole("\$rc_monthly")?.sku)
        assertEquals("cappy_plus_annual", twoMonthlies.productForRole("\$rc_annual")?.sku)
    }

    @Test
    fun a_non_canonical_role_still_resolves_to_nothing() {
        // The fallback maps PERIODS, not arbitrary names — a tenant-invented role genuinely needs
        // an offering, and pretending otherwise would bind a plan to whatever product sorted first.
        assertNull(legacyTenant.productForRole("\$rc_founders_club"))
    }

    @Test
    fun an_explicit_offering_still_wins_over_the_fallback() {
        val withOffering = SuiteConfig(
            tenantId = "modern",
            products = listOf(sub("yearly_v2", "year"), sub("yearly_promo", "year")),
            offerings = listOf(
                com.mobilebytelabs.paycraft.config.OfferingDto(
                    id = "o1", identifier = "default", displayName = "Default", isCurrent = true,
                    packages = listOf(
                        com.mobilebytelabs.paycraft.config.PackageDto(
                            id = "p1",
                            roleIdentifier = "\$rc_annual",
                            displayName = "Annual",
                            productSkus = listOf("yearly_promo"),
                        ),
                    ),
                ),
            ),
        )
        // Two yearly products exist; the offering is what says WHICH one this role sells.
        assertEquals("yearly_promo", withOffering.productForRole("\$rc_annual")?.sku)
    }

    @Test
    fun inactive_products_are_not_resolved() {
        val config = SuiteConfig(
            tenantId = "t",
            products = listOf(sub("yearly_v2", "year").copy(active = false)),
        )
        assertNull(config.productForRole("\$rc_annual"))
    }
}
