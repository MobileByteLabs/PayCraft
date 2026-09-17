package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeContent
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The tree renders, reacts, and localises — verified on the SAME deterministic frame as the template
 * goldens, so a tree's output can be diffed against the template it will eventually replace (D4).
 */
@OptIn(ExperimentalTestApi::class)
class PaywallTreeRenderTest {

    private val json = """
    {"schema_version":2,"initial_step_id":"s1","steps":[
      {"id":"s1","name":"Paywall","is_last_step":true,"components_config":{
        "type":"stack","dimension":"vertical","spacing":12,
        "padding":{"top":24,"leading":20,"bottom":24,"trailing":20},
        "components":[
          {"type":"text","text_lid":"hero","font_size":24,"font_weight_int":700,
           "color":{"light":{"type":"hex","value":"#010101ff"}},"horizontal_alignment":"center",
           "overrides":[{"conditions":[{"type":"intro_offer"}],"properties":{"text_lid":"hero_trial"}}]},
          {"type":"package","package_id":"${'$'}rc_annual","is_selected_by_default":true,
           "stack":{"type":"stack","components":[{"type":"text","text_lid":"annual"}]}},
          {"type":"package","package_id":"${'$'}rc_monthly",
           "stack":{"type":"stack","components":[{"type":"text","text_lid":"monthly"}]}},
          {"type":"mystery_node"},
          {"type":"purchase_button","text_lid":"cta"},
          {"type":"restore_purchases","text_lid":"restore"}
        ]}}],
     "localizations":{"en_US":{"hero":"Upgrade to Premium","hero_trial":"Start your free week",
        "annual":"Annual","monthly":"Monthly","cta":"Continue","restore":"Restore Purchases"}}}
    """.trimIndent()

    @Composable
    private fun Frame(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                Modifier.size(width = 411.dp, height = 891.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) { PayCraftThemeProvider(content = content) }
        }
    }

    @Test
    fun renders_a_server_authored_tree() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(json))
        setContent {
            Frame {
                PaywallTreeContent(
                    workflow = wf,
                    context = RenderContext(locale = "en_US", selectedPackageRole = "\$rc_annual"),
                    priceFor = { role ->
                        if (role == "\$rc_annual") PackagePrice("$41.99/yr") else PackagePrice("$6.99/mo")
                    },
                )
            }
        }
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Annual").assertIsDisplayed()
        onNodeWithText("Monthly").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()
        // Uppercased by the renderer to match the templates' micro-footer treatment — the lid
        // still reads "Restore Purchases"; the casing is presentation.
        onNodeWithText("RESTORE PURCHASES").assertIsDisplayed()
        // Price resolved by ROLE at render time, never authored into the tree.
        onNodeWithText("$41.99/yr").assertIsDisplayed()
        onRoot().captureRoboImage(P_TREE)
    }

    @Test
    fun intro_offer_override_swaps_the_headline() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(json))
        setContent {
            Frame {
                PaywallTreeContent(workflow = wf, context = RenderContext(hasIntroOffer = true))
            }
        }
        // Same tree, different truth about the world → different copy, with no renderer branch.
        onNodeWithText("Start your free week").assertIsDisplayed()
    }

    @Test
    fun tapping_a_package_raises_its_role_not_a_sku() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(json))
        val picked = mutableListOf<String>()
        setContent {
            Frame {
                PaywallTreeContent(
                    workflow = wf,
                    context = RenderContext(),
                    onSelectPackage = { picked += it },
                )
            }
        }
        onNodeWithText("Monthly").performClick()
        assertEquals(listOf("\$rc_monthly"), picked, "selection must raise the package ROLE (D8)")
    }

    @Test
    fun unknown_node_does_not_break_the_render() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(json))
        setContent { Frame { PaywallTreeContent(workflow = wf, context = RenderContext()) } }
        // `mystery_node` sits between the packages and the CTA. If degradation were a hard failure
        // the CTA below it would never compose — that is the blank-paywall class this guards.
        onNodeWithText("Continue").assertIsDisplayed()
        assertTrue(true)
    }

    private companion object {
        const val P_TREE = "src/jvmTest/resources/screenshots/paywall_tree_render.png"
    }
}
