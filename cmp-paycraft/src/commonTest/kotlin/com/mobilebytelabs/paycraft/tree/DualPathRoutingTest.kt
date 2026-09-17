package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.config.OfferingDto
import com.mobilebytelabs.paycraft.config.PackageDto
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.config.productForRole
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.packageRoles
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * D7 — the routing decision and the role→product mapping it depends on.
 *
 * The failure this guards is asymmetric. A tenant WITH a tree getting the template is a cosmetic
 * regression; a tenant WITHOUT one getting the tree path is a blank paywall — every tenant who has
 * never opened the designer, which is most of them.
 */
class DualPathRoutingTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private fun config(workflowJson: String?) = SuiteConfig(
        tenantId = "t1",
        products = listOf(
            ProductDto(id = "p_year", sku = "sku_year", type = "subscription", displayName = "Annual"),
            ProductDto(id = "p_month", sku = "sku_month", type = "subscription", displayName = "Monthly"),
        ),
        offerings = listOf(
            OfferingDto(
                id = "o1",
                identifier = "default",
                isCurrent = true,
                packages = listOf(
                    PackageDto(roleIdentifier = "\$rc_annual", productSkus = listOf("sku_year")),
                    PackageDto(roleIdentifier = "\$rc_monthly", productSkus = listOf("sku_month")),
                ),
            ),
        ),
        paywall = PaywallDto(
            workflow = workflowJson?.let { json.parseToJsonElement(it) },
            schemaVersion = if (workflowJson == null) 1 else 2,
        ),
    )

    private val tree = """
      {"schema_version":2,"initial_step_id":"s1","steps":[
        {"id":"s1","components_config":{"type":"stack","components":[
          {"type":"package","package_id":"${'$'}rc_annual","stack":{"type":"stack","components":[]}},
          {"type":"package","package_id":"${'$'}rc_monthly","stack":{"type":"stack","components":[]}}
        ]}}]}
    """.trimIndent()

    @Test
    fun no_published_tree_means_null_and_the_template_path() {
        val cfg = config(null)
        assertNull(cfg.paywall.workflow, "a tenant who never published must have no tree")
        assertEquals(1, cfg.paywall.schemaVersion)
    }

    @Test
    fun a_published_tree_parses_and_exposes_its_roles() {
        val cfg = config(tree)
        val wf = assertNotNull(PaywallTreeParser.parse(cfg.paywall.workflow!!.toString()))
        assertEquals(listOf("\$rc_annual", "\$rc_monthly"), wf.packageRoles())
    }

    @Test
    fun unparseable_tree_falls_back_rather_than_rendering_empty() {
        // The routing treats a null parse as "no tree". Reaching the tree path with an empty
        // workflow would render a paywall with nothing purchasable.
        assertNull(PaywallTreeParser.parse("""{"schema_version":2,"steps":[]}"""))
    }

    @Test
    fun roles_resolve_to_products_through_offerings_not_skus_in_the_tree() {
        val cfg = config(tree)
        assertEquals("p_year", cfg.productForRole("\$rc_annual")?.id)
        assertEquals("p_month", cfg.productForRole("\$rc_monthly")?.id)
        // A role the tenant never configured yields null → the card renders without a price
        // instead of inventing one.
        assertNull(cfg.productForRole("\$rc_weekly"))
    }

    @Test
    fun current_offering_wins_when_a_role_appears_in_several() {
        val cfg = SuiteConfig(
            tenantId = "t1",
            products = listOf(
                ProductDto(id = "old", sku = "sku_old", type = "subscription", displayName = "Old"),
                ProductDto(id = "new", sku = "sku_new", type = "subscription", displayName = "New"),
            ),
            offerings = listOf(
                OfferingDto(
                    id = "legacy",
                    identifier = "legacy",
                    isCurrent = false,
                    packages = listOf(PackageDto(roleIdentifier = "\$rc_annual", productSkus = listOf("sku_old"))),
                ),
                OfferingDto(
                    id = "current",
                    identifier = "default",
                    isCurrent = true,
                    packages = listOf(PackageDto(roleIdentifier = "\$rc_annual", productSkus = listOf("sku_new"))),
                ),
            ),
        )
        assertEquals("new", cfg.productForRole("\$rc_annual")?.id, "the current offering must win")
    }
}
