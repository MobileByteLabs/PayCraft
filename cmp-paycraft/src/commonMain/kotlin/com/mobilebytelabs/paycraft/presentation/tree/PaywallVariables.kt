package com.mobilebytelabs.paycraft.presentation.tree

/**
 * `{{ product.price }}`-style substitution inside authored paywall copy (D13 companion).
 *
 * ## Why copy carries variables instead of the renderer drawing prices
 * Before this, price was an OVERLAY: the renderer drew price, per-period note and savings chip in a
 * corner of every package card, positioned by the renderer rather than by the author. That has two
 * costs. Visually, the overlay is not part of the card's measured height, so a card whose authored
 * stack is short renders its price OUTSIDE its own background and border — obvious the moment a
 * selected-state ring is drawn around it. Structurally, it means price placement is the one part of
 * the paywall a tenant cannot move, which is precisely the freedom the component tree exists to give.
 *
 * With substitution, price is just text the author placed: a `text` node whose lid resolves to
 * "{{ product.price }}" sits wherever the author put it, inside the card, inheriting the card's
 * layout and clipping like any other child.
 *
 * ## Unknown variables resolve to empty, never to their own source
 * An unrecognised `{{ product.whatever }}` renders as nothing rather than printing braces at a
 * paying customer. The tradeoff is that an authoring typo is silent on-device — so it is caught
 * upstream instead: [PAYWALL_VARIABLES] is the closed set the dashboard offers and the seed test
 * asserts no shipped seed contains an unresolved variable.
 */
internal val PAYWALL_VARIABLES = listOf(
    "product.price",
    "product.price_per_period",
    "product.offer_savings",
    "product.offer_savings_label",
)

/**
 * Both braces are escaped on BOTH sides, and that is not stylistic.
 *
 * The desktop JVM's `java.util.regex` accepts a bare `}` as a literal, so `\s*}}` compiled fine and
 * every JVM test passed. Android's engine is stricter and threw `PatternSyntaxException` from this
 * file's STATIC INITIALIZER — which surfaces as `ExceptionInInitializerError` the first time any
 * paywall tree renders, i.e. the app dies opening the paywall. Found only on a device, after 416
 * green JVM tests. [PATTERN_HAS_NO_UNESCAPED_BRACES] is the regression guard.
 */
private const val PATTERN_SOURCE = """\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}"""

private val PATTERN = Regex(PATTERN_SOURCE)

/**
 * Exposed for the guard test: a JVM test cannot catch the stricter engine by compiling the pattern,
 * because the JVM is the lenient one. It can check the SOURCE, which is what this allows.
 */
internal fun paywallVariablePatternSource(): String = PATTERN_SOURCE

/** True when [text] contains any `{{ … }}` variable — used to decide whether a card prices itself. */
internal fun hasVariable(text: String): Boolean = PATTERN.containsMatchIn(text)

/**
 * Replace every `{{ … }}` in [text] using [price]; unknown or unpriced variables become "".
 *
 * [price] is null when the owning package has no resolvable product (wrong role, store not loaded).
 * Every variable then resolves to empty, so a card degrades to its static copy rather than showing
 * a stale or invented number on a payment surface.
 */
internal fun substituteVariables(text: String, price: PackagePrice?): String = if (!hasVariable(text)) {
    text
} else {
    PATTERN.replace(text) { m ->
        when (m.groupValues[1]) {
            "product.price" -> price?.display.orEmpty()
            "product.price_per_period" -> price?.perPeriodNote.orEmpty()
            "product.offer_savings" -> price?.savingsPercent?.let { "$it%" }.orEmpty()
            // The WHOLE label, including the word, because a literal wrapped around an empty
            // variable survives the variable: "SAVE {{ product.offer_savings }}" on a plan with no
            // saving renders the chip "SAVE" — a badge that promises a discount and names none.
            "product.offer_savings_label" -> price?.savingsPercent?.let { "SAVE $it%" }.orEmpty()
            else -> ""
        }
    }
}

/**
 * True when this subtree lays out its own price — i.e. any text in it carries a `{{ … }}` variable.
 *
 * Resolution goes through the localization table because the variable lives in the TRANSLATED copy,
 * not in the node: `{"price_line": "{{ product.price }}"}`. Checking the lid would find nothing.
 */
internal fun PaywallNode.pricesItself(workflow: PaywallWorkflow, context: RenderContext): Boolean = when (this) {
    is PaywallNode.Text -> hasVariable(workflow.resolve(textLid, context.locale))
    is PaywallNode.Stack -> components.any { it.pricesItself(workflow, context) }
    is PaywallNode.Package -> stack.pricesItself(workflow, context)
    is PaywallNode.PurchaseButton -> stack?.pricesItself(workflow, context) == true
    is PaywallNode.Footer -> components.any { it.pricesItself(workflow, context) }
    else -> false
}

/**
 * True when this node would paint nothing but its own decoration.
 *
 * A savings chip is a background + padding wrapping one text; when the text substitutes to empty
 * the text disappears but the chip does not, leaving a small coloured pill floating in the card.
 * So a stack whose every child renders nothing is skipped along with its children.
 *
 * A stack with NO children is exempt: an empty decorated stack is a divider or a rule, and its
 * whole purpose is to paint decoration with no content.
 */
internal fun PaywallNode.rendersNothing(
    workflow: PaywallWorkflow,
    context: RenderContext,
    price: PackagePrice?,
): Boolean = when (this) {
    is PaywallNode.Text ->
        substituteVariables(workflow.resolve(textLid, context.locale), price).isBlank()
    is PaywallNode.Spacer -> true
    is PaywallNode.Stack ->
        components.isNotEmpty() && components.all { it.rendersNothing(workflow, context, price) }
    else -> false
}
