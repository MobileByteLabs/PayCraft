package com.mobilebytelabs.paycraft.presentation.tree

import com.mobilebytelabs.paycraft.config.PaywallDto

/**
 * Carries a tenant's v1 dashboard settings into a built-in seed tree.
 *
 * ## The migration this exists to prevent
 * Two v1 fields were rendered by the four Kotlin templates and by nothing else: `valueProps` (the
 * bullet list under the hero) and `popularPlanSku` (which plan wears the recommended ring). A tenant
 * configured them in the dashboard years before component trees existed. Deleting the templates (D3)
 * without this would drop both — silently, for every tenant who set them and never authored a tree.
 * The golden suite caught exactly that, which is the only reason it is not already shipped broken.
 *
 * ## Applied to SEEDS only, never to an authored tree
 * A tenant who authored a tree expressed their own design; injecting config-driven nodes into it
 * would override choices they made deliberately — including the choice to have no value props. So
 * the caller applies this only when falling back to a bundled seed.
 *
 * ## Why nodes and overrides rather than a special case in the renderer
 * Rendering these from config inside the renderer would put layout back in Kotlin, which is the
 * thing the tree replaced. As nodes they are inspectable, previewable in the dashboard, and
 * editable the moment a tenant adopts a tree of their own.
 */
internal fun PaywallWorkflow.withV1Config(paywall: PaywallDto, isPopularRole: (String) -> Boolean): PaywallWorkflow {
    if (paywall.valueProps.isEmpty() && paywall.popularPlanSku.isNullOrBlank()) return this

    val lids = mutableMapOf<String, String>()
    val propNodes = mutableListOf<PaywallNode>()
    paywall.valueProps.forEachIndexed { i, vp ->
        val titleLid = "__vp_${i}_title"
        lids[titleLid] = vp.title
        propNodes += PaywallNode.Text(textLid = titleLid, fontSize = 15, fontWeight = 600)
        vp.description?.takeIf { it.isNotBlank() }?.let { desc ->
            val descLid = "__vp_${i}_desc"
            lids[descLid] = desc
            propNodes += PaywallNode.Text(textLid = descLid, fontSize = 13)
        }
    }

    fun transform(node: PaywallNode): PaywallNode = when (node) {
        is PaywallNode.Stack -> {
            // Value props go immediately before the first plan — the slot the templates used
            // (hero → subtitle → value props → plans), so the order a tenant already sees holds.
            val firstPackage = node.components.indexOfFirst { it is PaywallNode.Package }
            val kids = node.components.map(::transform).toMutableList()
            if (propNodes.isNotEmpty() && firstPackage >= 0) {
                kids.addAll(firstPackage, propNodes)
            }
            node.copy(components = kids)
        }

        is PaywallNode.Package ->
            if (isPopularRole(node.roleIdentifier)) {
                // An always-true override rather than a new node field: `recommended` is styling,
                // and styling in this model is a property the renderer reads, not a schema branch.
                // An override with NO conditions applies unconditionally (`all {}` on an empty
                // list is true) — the model's way of saying "always", without a schema branch.
                // `recommended` is styling, and styling here is a property the renderer reads.
                node.copy(
                    overrides = node.overrides + Override(
                        conditions = emptyList(),
                        properties = mapOf("recommended" to "true"),
                    ),
                )
            } else {
                node
            }

        is PaywallNode.Footer -> node.copy(components = node.components.map(::transform))
        else -> node
    }

    val merged = localizations.mapValues { (_, table) -> table + lids }
        .ifEmpty { mapOf("en_US" to lids) }

    return copy(
        steps = steps.map { it.copy(root = it.root?.let(::transform)) },
        localizations = merged,
    )
}
