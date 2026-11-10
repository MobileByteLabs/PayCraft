/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.config

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * `roleForSku` is the inverse of `productForRole`, and tier membership is a PACKAGE ROLE.
 *
 * WHY THIS EXISTS
 * A consumer has to be able to ask "which tier is this plan?" to render a superset badge or gate a
 * tier-only capability. The forward direction existed; the reverse did not, so consumers hardcoded
 * the answer. Measured on `mbs/cappy` 2026-10-07: `SubscriptionPlan.isGuardian: Boolean`, set in an
 * app-side catalogue — a tier fact duplicated in app source, so renaming or re-pricing the tier in
 * the dashboard never reached the app.
 *
 * The precedence test is the load-bearing one: if the two functions disagree about which offering
 * wins, a plan can resolve to one role going forward and a different one coming back, which is worse
 * than having no inverse at all.
 */
class RoleForSkuTest {

    private fun product(id: String, sku: String) = ProductDto(
        id = id,
        sku = sku,
        type = "subscription",
        displayName = sku,
        interval = "month",
    )

    private fun config(vararg offerings: OfferingDto) = SuiteConfig(
        tenantId = "t1",
        products = listOf(product("p1", "plus_monthly"), product("p2", "guardian_monthly")),
        offerings = offerings.toList(),
    )

    private fun offering(id: String, isCurrent: Boolean, vararg pkgs: PackageDto) =
        OfferingDto(id = id, identifier = id, isCurrent = isCurrent, packages = pkgs.toList())

    @Test
    fun resolves_the_role_that_fronts_the_sku() {
        val c = config(
            offering(
                "o1",
                true,
                PackageDto(id = "k1", roleIdentifier = "plus", productSkus = listOf("plus_monthly")),
                PackageDto(id = "k2", roleIdentifier = "guardian", productSkus = listOf("guardian_monthly")),
            ),
        )
        assertEquals("plus", c.roleForSku("plus_monthly"))
        assertEquals("guardian", c.roleForSku("guardian_monthly"))
    }

    @Test
    fun prefers_the_current_offering_exactly_as_productForRole_does() {
        // Same sku fronted by DIFFERENT roles in two offerings. Both functions must pick the current
        // one, or forward and reverse disagree and a plan's tier becomes ambiguous.
        val c = config(
            offering("old", false, PackageDto(roleIdentifier = "legacy", productSkus = listOf("plus_monthly"))),
            offering("new", true, PackageDto(roleIdentifier = "plus", productSkus = listOf("plus_monthly"))),
        )
        assertEquals("plus", c.roleForSku("plus_monthly"))
        // Round-trip: the role we got back must resolve forward to the same sku.
        assertEquals("plus_monthly", c.productForRole("plus")?.sku)
    }

    @Test
    fun returns_null_rather_than_guessing() {
        // No offerings at all — every pre-offerings tenant. A guessed tier is worse than none.
        assertNull(config().roleForSku("plus_monthly"))
        // Offerings exist but this sku is in no package.
        val c = config(offering("o1", true, PackageDto(roleIdentifier = "plus", productSkus = listOf("other"))))
        assertNull(c.roleForSku("plus_monthly"))
        // Blank input is not a lookup.
        assertNull(c.roleForSku(""))
    }

    @Test
    fun a_blank_role_identifier_is_null_not_empty_string() {
        // A package with no role set must read as untiered. Returning "" would make a consumer's
        // `role == "guardian"` comparison work by accident and `role != null` lie.
        val c = config(offering("o1", true, PackageDto(roleIdentifier = "", productSkus = listOf("plus_monthly"))))
        assertNull(c.roleForSku("plus_monthly"))
    }
}
