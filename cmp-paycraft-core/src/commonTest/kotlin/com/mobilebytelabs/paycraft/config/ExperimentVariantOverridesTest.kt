package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Migration 227: a variant may change the paywall design and the exit offer; other arms are untouched. */
class ExperimentVariantOverridesTest {

    private fun sub(sku: String) = ProductDto(id = "id_$sku", sku = sku, type = "subscription", displayName = sku)
    private fun offering(id: String, sku: String) = OfferingDto(
        id = id,
        identifier = id,
        isCurrent = id == "control",
        packages = listOf(PackageDto(id = "p_$sku", roleIdentifier = "\$rc_monthly", productSkus = listOf(sku))),
    )

    private val half = buildJsonObject {
        put("percent_off", 50)
        put("duration", "repeating")
        put("duration_in_months", 3)
    }
    private val experiment = ExperimentDto(
        key = "design",
        variants = listOf(
            ExperimentVariantDto("control", 34, "control"),
            ExperimentVariantDto("minimal", 33, "control", paywallTemplate = "minimal", exitOffer = half),
            ExperimentVariantDto("no-exit", 33, "control", exitOffer = JsonPrimitive(false)),
        ),
    )
    private val config = SuiteConfig(
        tenantId = "t",
        products = listOf(sub("pro-monthly")),
        offerings = listOf(offering("control", "pro-monthly")),
        paywall = PaywallDto(template = "branded-stack", workflow = JsonPrimitive("tree")),
        experiment = experiment.toJson(),
    )
    private fun deviceIn(arm: String) = (0 until 500).map { "d$it" }.first { experiment.assign(it)!!.key == arm }

    private val survey = ExitSurveyConfig(
        enabled = true,
        reasons = listOf(ExitSurveyConfig.Reason("x", "X")),
        exitOffer = ExitSurveyConfig.Offer(25),
    )

    @Test fun a_design_arm_renders_its_template_instead_of_the_published_tree() {
        val (applied, a) = config.withExperimentAssigned(deviceIn("minimal"))
        assertEquals("minimal", applied.paywall.template)
        assertNull(applied.paywall.workflow)
        assertEquals(applied to a, applied.withExperimentAssigned(deviceIn("minimal")))
    }

    @Test fun the_control_keeps_the_paywall_and_the_tenants_exit_offer() {
        val (applied, a) = config.withExperimentAssigned(deviceIn("control"))
        assertSame(config.paywall, applied.paywall)
        assertSame(survey, survey.forVariant(a))
    }

    @Test fun an_arm_replaces_or_turns_off_the_exit_offer() {
        val half = survey.forVariant(config.withExperimentAssigned(deviceIn("minimal")).second)!!
        assertEquals(50, half.exitOffer!!.percentOff)
        assertEquals(3, half.exitOffer!!.durationInMonths)
        assertNull(survey.forVariant(config.withExperimentAssigned(deviceIn("no-exit")).second)!!.exitOffer)
    }

    @Test fun an_arms_offer_turns_on_a_survey_the_tenant_left_empty() {
        val a = config.withExperimentAssigned(deviceIn("minimal")).second
        assertTrue(ExitSurveyConfig().forVariant(a)!!.enabled)
    }

    @Test fun the_wire_form_round_trips() {
        val back = config.experimentOrNull()!!
        assertEquals("minimal", back.variants[1].paywallTemplate)
        assertEquals(JsonPrimitive(false), back.variants[2].exitOffer)
        assertNull(back.variants[0].exitOffer)
    }
}
