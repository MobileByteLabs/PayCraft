package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import com.mobilebytelabs.paycraft.presentation.tree.BuiltInPaywallSeeds
import com.mobilebytelabs.paycraft.presentation.tree.PaywallNode
import com.mobilebytelabs.paycraft.presentation.tree.PaywallWorkflow
import com.mobilebytelabs.paycraft.presentation.tree.packageRoles
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Every template value must resolve to a bundled, parseable, PURCHASABLE tree.
 *
 * The mapping is a `when` over the enum, so adding a template value without shipping its seed is a
 * compile error — but shipping a seed that does not PARSE, or that has no way to buy anything, both
 * compile fine and fail on a customer's screen. Those are what this asserts.
 */
class BuiltInPaywallSeedsTest {

    @Test
    fun every_template_has_a_bundled_tree_that_parses() = runTest {
        for (template in PaywallTemplate.entries) {
            val wf = BuiltInPaywallSeeds.workflow(template)
            assertNotNull(wf, "$template has no bundled seed tree, or it failed to parse")
            assertEquals(2, wf.schemaVersion, "$template: bundled seed is not schema_version 2")
            assertTrue(wf.steps.isNotEmpty(), "$template: bundled seed has no steps")
            assertNotNull(
                wf.steps.find { it.id == wf.initialStepId },
                "$template: initial_step_id does not resolve to a step",
            )
        }
    }

    @Test
    fun every_bundled_tree_can_be_purchased_from() = runTest {
        for (template in PaywallTemplate.entries) {
            val wf = assertNotNull(BuiltInPaywallSeeds.workflow(template))
            // `package` nodes only SELECT — without a purchase_button the paywall is a dead end,
            // which is exactly the defect the seed conversion surfaced (D17's sibling).
            assertTrue(
                countNodes(wf) { it is PaywallNode.PurchaseButton } > 0,
                "$template: bundled seed has no purchase button — nothing can be bought",
            )
            assertTrue(
                wf.packageRoles().size >= 2,
                "$template: bundled seed offers fewer than two plans",
            )
        }
    }

    private fun countNodes(wf: PaywallWorkflow, predicate: (PaywallNode) -> Boolean): Int {
        var n = 0
        fun walk(node: PaywallNode?) {
            if (node == null) return
            if (predicate(node)) n++
            when (node) {
                is PaywallNode.Stack -> node.components.forEach(::walk)
                is PaywallNode.Footer -> node.components.forEach(::walk)
                is PaywallNode.Package -> walk(node.stack)
                is PaywallNode.PurchaseButton -> walk(node.stack)
                else -> Unit
            }
        }
        wf.steps.forEach { walk(it.root) }
        return n
    }
}
