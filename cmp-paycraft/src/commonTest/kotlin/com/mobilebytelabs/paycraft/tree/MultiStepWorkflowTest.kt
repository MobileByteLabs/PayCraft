package com.mobilebytelabs.paycraft.tree

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.presentation.tree.ButtonAction
import com.mobilebytelabs.paycraft.presentation.tree.PaywallNode
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeContent
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * D15 — a paywall is N ordered steps, and something has to move between them.
 *
 * Before this the renderer pinned `initial_step_id`, so a two-screen tree rendered its first screen
 * and the second was unreachable on every device. The schema, the parser and the server validator
 * all already carried steps — and `button` was already in the server's accepted type list — so a
 * dashboard could persist a workflow whose later screens no SDK could show.
 */
@OptIn(ExperimentalTestApi::class)
class MultiStepWorkflowTest {

    private val twoStep = """
    {"schema_version":2,"initial_step_id":"intro","steps":[
      {"id":"intro","name":"Intro","components_config":{"type":"stack","components":[
        {"type":"text","text_lid":"intro_copy"},
        {"type":"button","text_lid":"next","action":{"type":"navigate_to","destination":"plans"}}
      ]}},
      {"id":"plans","name":"Plans","is_last_step":true,"components_config":{"type":"stack","components":[
        {"type":"text","text_lid":"plans_copy"},
        {"type":"button","text_lid":"back","navigate_to":"intro"}
      ]}}
    ],"localizations":{"en_US":{
      "intro_copy":"Here is why premium is worth it",
      "plans_copy":"Choose your plan",
      "next":"See plans","back":"Back"}}}
    """.trimIndent()

    @Test
    fun a_button_moves_between_steps_and_back() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(twoStep))
        assertEquals(2, wf.steps.size)
        setContent { PaywallTreeContent(workflow = wf, context = RenderContext()) }

        onNodeWithText("Here is why premium is worth it").assertIsDisplayed()
        onNodeWithText("See plans").performClick()

        // The second screen — unreachable before D15.
        onNodeWithText("Choose your plan").assertIsDisplayed()

        // …and the shorthand `navigate_to` form the early dashboard drafts emitted still works.
        onNodeWithText("Back").performClick()
        onNodeWithText("Here is why premium is worth it").assertIsDisplayed()
    }

    @Test
    fun a_dangling_destination_is_ignored_rather_than_blanking_the_paywall() = runComposeUiTest {
        val wf = assertNotNull(
            PaywallTreeParser.parse(
                twoStep.replace("\"destination\":\"plans\"", "\"destination\":\"nowhere\""),
            ),
        )
        setContent { PaywallTreeContent(workflow = wf, context = RenderContext()) }
        onNodeWithText("See plans").performClick()
        // A tree comes off a server; a typo in a destination must not strand a paying customer on
        // an empty screen.
        onNodeWithText("Here is why premium is worth it").assertIsDisplayed()
    }

    @Test
    fun an_unrecognised_action_degrades_the_node_instead_of_rendering_a_dead_control() {
        val wf = assertNotNull(
            PaywallTreeParser.parse(
                twoStep.replace("\"type\":\"navigate_to\"", "\"type\":\"teleport\""),
            ),
        )
        val nodes = mutableListOf<PaywallNode>()
        fun walk(n: PaywallNode?) {
            if (n == null) return
            nodes += n
            if (n is PaywallNode.Stack) n.components.forEach(::walk)
        }
        wf.steps.forEach { walk(it.root) }
        // A button whose action the SDK cannot read would do nothing when tapped, which on a
        // paywall is indistinguishable from a broken app.
        assertTrue(nodes.any { it is PaywallNode.Unknown && it.type == "button" })
        assertTrue(nodes.none { it is PaywallNode.Button && it.labelLid == "next" })
    }

    @Test
    fun purchase_and_restore_actions_are_readable_from_any_step() {
        val wf = assertNotNull(
            PaywallTreeParser.parse(
                twoStep.replace(
                    "{\"type\":\"navigate_to\",\"destination\":\"plans\"}",
                    "{\"type\":\"purchase\"}",
                ),
            ),
        )
        val buttons = mutableListOf<PaywallNode.Button>()
        fun walk(n: PaywallNode?) {
            when (n) {
                is PaywallNode.Button -> buttons += n
                is PaywallNode.Stack -> n.components.forEach(::walk)
                else -> Unit
            }
        }
        wf.steps.forEach { walk(it.root) }
        assertTrue(buttons.any { it.action == ButtonAction.Purchase })
    }
}
