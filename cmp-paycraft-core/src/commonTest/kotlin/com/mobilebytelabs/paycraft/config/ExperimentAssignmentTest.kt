package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Paywall A/B experiments (migration 206): a device lands in one variant, keeps it, and sees only that variant's
 * plans; a broken experiment never breaks the paywall.
 */
class ExperimentAssignmentTest {

    private fun sub(sku: String, interval: String = "month") =
        ProductDto(id = "id_$sku", sku = sku, type = "subscription", displayName = sku, interval = interval)

    private fun offering(id: String, vararg skus: String) = OfferingDto(
        id = id,
        identifier = id,
        isCurrent = id == "control",
        packages = skus.map { PackageDto(id = "p_$it", roleIdentifier = "\$rc_monthly", productSkus = listOf(it)) },
    )

    private val experiment = ExperimentDto(
        key = "price-test",
        variants = listOf(
            ExperimentVariantDto("control", 50, "control"),
            ExperimentVariantDto("cheaper", 50, "cheaper"),
        ),
    )

    private val config = SuiteConfig(
        tenantId = "t",
        products = listOf(sub("pro-monthly"), sub("pro-monthly-low"), sub("pro-lifetime", "year")),
        offerings = listOf(offering("control", "pro-monthly"), offering("cheaper", "pro-monthly-low")),
        experiment = experiment.toJson(),
    )

    @Test
    fun a_device_keeps_its_variant() {
        val first = experiment.assign("device-1")
        repeat(5) { assertEquals(first, experiment.assign("device-1")) }
    }

    @Test
    fun devices_split_roughly_by_weight() {
        val counts = (0 until 2000).groupingBy { experiment.assign("device-$it")!!.key }.eachCount()
        val control = counts["control"] ?: 0
        assertTrue(control in 850..1150, "50/50 split, got $counts")
    }

    @Test
    fun the_device_sees_only_its_variants_plans_and_untouched_products_stay() {
        val device = (0 until 100).map { "d$it" }.first { experiment.assign(it)!!.key == "cheaper" }
        val (applied, assignment) = config.withExperimentAssigned(device)
        assertEquals(ExperimentAssignment("price-test", "cheaper"), assignment)
        assertEquals(listOf("pro-monthly-low", "pro-lifetime"), applied.products.map { it.sku })
        assertEquals("cheaper", applied.offerings.single { it.isCurrent }.id)
        assertEquals("pro-monthly-low", applied.productForRole("\$rc_monthly")?.sku)
        // Re-applying is a no-op: config refreshes and native-price re-applies run it again.
        assertEquals(applied to assignment, applied.withExperimentAssigned(device))
    }

    @Test
    fun no_or_broken_experiment_leaves_the_paywall_alone() {
        val none = config.copy(experiment = null)
        assertSame(none, none.withExperimentAssigned("d").first)
        val missingOffering = config.copy(
            experiment = experiment.copy(variants = experiment.variants.map { it.copy(offeringId = "gone") }).toJson(),
        )
        val (same, assignment) = missingOffering.withExperimentAssigned("d")
        assertSame(missingOffering, same)
        assertNull(assignment)
        // A variant whose offering sells nothing must not empty the paywall: normal paywall, no variant tag.
        val emptyOffering = config.copy(offerings = listOf(offering("control", "pro-monthly"), offering("cheaper")))
        (0 until 20).forEach { d ->
            val (applied, tag) = emptyOffering.withExperimentAssigned("d$d")
            if (experiment.assign("d$d")!!.key == "cheaper") {
                assertSame(emptyOffering, applied)
                assertNull(tag)
            }
        }
        assertNull(ExperimentDto(key = "x", variants = listOf(ExperimentVariantDto("a", 0, "control"))).assign("d"))
        assertNotNull(experiment.assign(""))
    }

    @Test
    fun a_variant_default_sku_rides_on_the_assignment_and_an_unknown_one_is_dropped() {
        val withDefault = experiment.copy(
            variants = listOf(
                ExperimentVariantDto("control", 50, "control"),
                ExperimentVariantDto("cheaper", 50, "cheaper", defaultSku = "pro-monthly-low"),
            ),
        )
        val cheaper = (0 until 100).map { "d$it" }.first { withDefault.assign(it)!!.key == "cheaper" }
        val control = (0 until 100).map { "d$it" }.first { withDefault.assign(it)!!.key == "control" }
        val cfg = config.copy(experiment = withDefault.toJson())
        assertEquals("pro-monthly-low", cfg.withExperimentAssigned(cheaper).second?.defaultSku)
        assertNull(cfg.withExperimentAssigned(control).second?.defaultSku)
        // A sku the variant doesn't sell (here: another variant's) falls back to the paywall's own default.
        val unknown = config.copy(
            experiment = withDefault.copy(
                variants = withDefault.variants.map { it.copy(defaultSku = it.defaultSku?.let { "pro-monthly" }) },
            ).toJson(),
        )
        val (_, tag) = unknown.withExperimentAssigned(cheaper)
        assertEquals(ExperimentAssignment("price-test", "cheaper", null), tag)
    }

    @Test
    fun the_server_payload_decodes() {
        // Verbatim shape of a local `/config` response's `experiment` block (functions served against migration 206).
        val wire = """{"tenant_id":"t","experiment":{"key":"price-test","variants":[""" +
            """{"key":"control","weight":50,"offering_id":"o-1"},{"key":"cheaper","weight":50,"offering_id":"o-2"}]}}"""
        val cfg = lenient.decodeFromString(SuiteConfig.serializer(), wire)
        assertEquals(ExperimentVariantDto("cheaper", 50, "o-2"), cfg.experimentOrNull()?.variants?.last())
        val withSku = wire.replace(""""offering_id":"o-2"""", """"offering_id":"o-2","default_sku":"pro-monthly"""")
        val decoded = lenient.decodeFromString(SuiteConfig.serializer(), withSku)
        assertEquals("pro-monthly", decoded.experimentOrNull()?.variants?.last()?.defaultSku)
        assertNull(
            lenient.decodeFromString(
                SuiteConfig.serializer(),
                """{"tenant_id":"t","experiment":null}""",
            ).experimentOrNull(),
        )
    }

    private val lenient = Json { ignoreUnknownKeys = true }
}
