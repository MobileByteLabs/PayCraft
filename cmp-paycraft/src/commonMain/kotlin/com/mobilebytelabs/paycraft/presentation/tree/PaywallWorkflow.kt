package com.mobilebytelabs.paycraft.presentation.tree

/**
 * A parsed, server-authored paywall: its screens, its strings, and the contract it was written for.
 */
data class PaywallWorkflow(
    val schemaVersion: Int,
    val initialStepId: String,
    val steps: List<PaywallStep>,
    /** locale → (localization id → string). Resolved at render time; see [resolve]. */
    val localizations: Map<String, Map<String, String>>,
    /**
     * "light" | "dark" — the scheme this tree was DESIGNED against.
     *
     * Necessary because a background colour on a node styles that node, not its descendants. A tree
     * that paints a dark surface and leaves its text nodes uncoloured renders dark-on-dark: every
     * uncoloured node falls back to the HOST theme's `onSurface`, which is dark when the host is
     * light. That is an unreadable paywall that throws nothing and passes every structural test —
     * observed directly when the Dark seed tree was first rendered.
     *
     * Declaring the scheme lets the renderer pick correct DEFAULTS, so a tenant only has to specify
     * the colours they actually want to override rather than every colour to avoid invisibility.
     */
    val colorScheme: String = "light",
) {
    val isDark: Boolean get() = colorScheme.equals("dark", ignoreCase = true)

    /** True when authored against a contract newer than this build renders (AC-5). */
    val isForwardVersion: Boolean get() = schemaVersion > PaywallTreeParser.SUPPORTED_SCHEMA_VERSION

    val initialStep: PaywallStep? get() = steps.firstOrNull { it.id == initialStepId } ?: steps.firstOrNull()

    fun step(id: String): PaywallStep? = steps.firstOrNull { it.id == id }

    /**
     * Resolve a localization id for [locale], falling back to [fallbackLocale], then to any locale
     * that has the string, and finally to the id itself.
     *
     * The last fallback is deliberate: showing `hero_title` is ugly, but it is debuggable and it
     * keeps the surrounding paywall purchasable. Returning empty would silently erase a headline or
     * a CTA label and leave a button with no text — a dead-looking control on a revenue surface.
     */
    fun resolve(lid: String, locale: String, fallbackLocale: String = "en_US"): String {
        localizations[locale]?.get(lid)?.let { return it }
        localizations[fallbackLocale]?.get(lid)?.let { return it }
        localizations.values.firstNotNullOfOrNull { it[lid] }?.let { return it }
        return lid
    }
}

data class PaywallStep(val id: String, val name: String, val isLastStep: Boolean, val root: PaywallNode?)

/**
 * What is true while rendering — the inputs every [Override] is judged against (D14).
 *
 * Passed down the tree rather than read from a singleton so a preview (dashboard, Roborazzi, a
 * @Preview) can render any combination without touching global billing state.
 */
data class RenderContext(
    val locale: String = "en_US",
    val hasIntroOffer: Boolean = false,
    val selectedPackageRole: String? = null,
    /**
     * Roles the catalogue actually offers, or null for "all of them".
     *
     * An app passes the roles it can price, so a tree authored with annual+monthly renders only
     * what the tenant sells. A preview or an authoring canvas passes null, because hiding plans
     * there would hide the thing the author is editing.
     */
    val availableRoles: Set<String>? = null,
)

/**
 * Apply a node's overrides for the current [context], returning the winning property values.
 *
 * Later overrides win: the tree is authored top-down, so a more specific rule written afterwards is
 * the one the author most recently intended.
 */
fun PaywallNode.effectiveProperties(context: RenderContext, packageRole: String? = null): Map<String, String> {
    val out = mutableMapOf<String, String>()
    for (override in overrides) {
        val holds = override.conditions.all { condition ->
            when (condition) {
                Condition.INTRO_OFFER -> context.hasIntroOffer
                // "selected" is about the package this node belongs to, not a global flag — which is
                // why the owning role has to be threaded in rather than read from the context alone.
                Condition.SELECTED -> packageRole != null && packageRole == context.selectedPackageRole
            }
        }
        if (holds) out += override.properties
    }
    return out
}

/**
 * Every package role this workflow references, in tree order.
 *
 * Used to translate between the ViewModel's plan-based selection and the tree's role-based one.
 * Walks all steps, not just the initial one: a multi-screen paywall can put its plans on a later
 * screen, and a role that only appears there still needs a price.
 */
fun PaywallWorkflow.packageRoles(): List<String> {
    val roles = mutableListOf<String>()
    fun walk(node: PaywallNode?) {
        when (node) {
            null -> Unit
            is PaywallNode.Package -> {
                roles += node.roleIdentifier
                walk(node.stack)
            }
            is PaywallNode.Stack -> node.components.forEach(::walk)
            is PaywallNode.Footer -> node.components.forEach(::walk)
            is PaywallNode.Timeline -> node.items.forEach(::walk)
            is PaywallNode.PurchaseButton -> walk(node.stack)
            else -> Unit
        }
    }
    steps.forEach { walk(it.root) }
    return roles.distinct()
}

/**
 * The package role the AUTHOR marked `is_selected_by_default`, or null if none is marked.
 *
 * Parsed since the tree existed but read by nothing until now, which meant the author's choice lost
 * to the ViewModel's generic "popular, else first" guess. On a two-plan paywall that guess is right
 * often enough to look correct and wrong exactly when a tenant deliberately leads with the plan the
 * guess does not pick — the case they changed the default FOR.
 */
fun PaywallWorkflow.defaultSelectedRole(): String? {
    var found: String? = null
    fun walk(node: PaywallNode?) {
        if (found != null) return
        when (node) {
            is PaywallNode.Package -> if (node.isSelectedByDefault) found = node.roleIdentifier else walk(node.stack)
            is PaywallNode.Stack -> node.components.forEach(::walk)
            is PaywallNode.Footer -> node.components.forEach(::walk)
            is PaywallNode.PurchaseButton -> walk(node.stack)
            else -> Unit
        }
    }
    steps.forEach { walk(it.root) }
    return found
}
