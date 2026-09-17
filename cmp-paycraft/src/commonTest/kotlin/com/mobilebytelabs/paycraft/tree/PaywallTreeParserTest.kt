package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.presentation.tree.Axis
import com.mobilebytelabs.paycraft.presentation.tree.Condition
import com.mobilebytelabs.paycraft.presentation.tree.Override
import com.mobilebytelabs.paycraft.presentation.tree.PaywallNode
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.presentation.tree.effectiveProperties
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PaywallTreeParserTest {

    private val tree = """
    {"schema_version":2,"initial_step_id":"s1","steps":[
      {"id":"s1","name":"Paywall","is_last_step":true,"components_config":{
        "type":"stack","dimension":"vertical","spacing":12,
        "padding":{"top":4,"leading":8,"bottom":4,"trailing":8},
        "background":{"value":{"light":{"type":"hex","value":"#ffffffff"}}},
        "components":[
          {"type":"text","text_lid":"hero","font_size":24,"font_weight_int":700,
           "color":{"light":{"type":"hex","value":"#010101ff"}},"horizontal_alignment":"center",
           "overrides":[{"conditions":[{"type":"intro_offer"}],"properties":{"text_lid":"hero_trial"}}]},
          {"type":"package","package_id":"${'$'}rc_annual","is_selected_by_default":true,
           "stack":{"type":"stack","components":[{"type":"text","text_lid":"annual"}]}},
          {"type":"purchase_button","text_lid":"cta"},
          {"type":"holo_carousel","spin":true},
          {"type":"restore_purchases","text_lid":"restore"}
        ]}}],
     "localizations":{"en_US":{"hero":"Upgrade","hero_trial":"Start your free trial",
                       "annual":"Annual","cta":"Continue","restore":"Restore"},
                      "de_DE":{"hero":"Upgraden"}}}
    """.trimIndent()

    @Test
    fun parses_workflow_steps_and_locales() {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        assertEquals(2, wf.schemaVersion)
        assertEquals("s1", wf.initialStepId)
        assertEquals(1, wf.steps.size)
        assertTrue(!wf.isForwardVersion)
        assertEquals("Upgrade", wf.resolve("hero", "en_US"))
        assertEquals("Upgraden", wf.resolve("hero", "de_DE"))
        // Missing in de_DE → falls back to en_US rather than blanking a CTA.
        assertEquals("Continue", wf.resolve("cta", "de_DE"))
        // Unknown lid returns the id: debuggable, and keeps the control labelled.
        assertEquals("nope", wf.resolve("nope", "en_US"))
    }

    @Test
    fun unknown_node_keeps_its_slot() {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        val root = wf.initialStep?.root as? PaywallNode.Stack
        assertNotNull(root)
        assertEquals(Axis.VERTICAL, root.axis)
        assertEquals(5, root.components.size)
        val unknown = root.components[3] as? PaywallNode.Unknown
        assertNotNull(unknown, "holo_carousel should degrade, not vanish")
        assertEquals("holo_carousel", unknown.type)
        assertTrue(root.components[2] is PaywallNode.PurchaseButton)
        assertTrue(root.components[4] is PaywallNode.RestorePurchases)
    }

    @Test
    fun package_binds_by_role_not_sku() {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        val root = wf.initialStep?.root as PaywallNode.Stack
        val pkg = root.components[1] as PaywallNode.Package
        assertEquals("\$rc_annual", pkg.roleIdentifier)
        assertTrue(pkg.isSelectedByDefault)
        assertEquals(1, pkg.stack.components.size)
    }

    @Test
    fun intro_offer_override_applies_only_when_the_condition_holds() {
        val wf = assertNotNull(PaywallTreeParser.parse(tree))
        val hero = (wf.initialStep?.root as PaywallNode.Stack).components[0] as PaywallNode.Text
        assertEquals("hero", hero.textLid)

        val plain = hero.effectiveProperties(RenderContext(hasIntroOffer = false))
        assertNull(plain["text_lid"], "override must not apply without an intro offer")

        val trial = hero.effectiveProperties(RenderContext(hasIntroOffer = true))
        assertEquals("hero_trial", trial["text_lid"])
        assertEquals("Start your free trial", wf.resolve(trial.getValue("text_lid"), "en_US"))
    }

    @Test
    fun selected_condition_is_scoped_to_the_owning_package() {
        val node = PaywallNode.Text(
            textLid = "x",
            overrides = listOf(
                Override(conditions = listOf(Condition.SELECTED), properties = mapOf("color" to "#ff0000")),
            ),
        )
        val ctx = RenderContext(selectedPackageRole = "\$rc_annual")
        assertEquals("#ff0000", node.effectiveProperties(ctx, packageRole = "\$rc_annual")["color"])
        assertNull(
            node.effectiveProperties(ctx, packageRole = "\$rc_monthly")["color"],
            "a different package must not inherit the selected styling",
        )
    }

    @Test
    fun malformed_payloads_return_null_rather_than_an_empty_paywall() {
        assertNull(PaywallTreeParser.parse("""{"schema_version":2,"steps":[]}"""))
        assertNull(PaywallTreeParser.parse("not json"))
    }

    @Test
    fun dangling_initial_step_falls_back_to_the_first_step() {
        val wf = assertNotNull(
            PaywallTreeParser.parse(
                """{"schema_version":2,"initial_step_id":"ghost","steps":[
                     {"id":"real","components_config":{"type":"stack","components":[]}}]}""",
            ),
        )
        assertEquals("real", wf.initialStepId)
    }
}
