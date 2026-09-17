package com.mobilebytelabs.paycraft.presentation.tree

/**
 * A node in a server-authored paywall component tree.
 *
 * ## Why this exists next to the templates rather than in cmp-remote-config
 * `cmp-remote-config` renders generic dynamic UI and knows nothing about billing. These nodes do:
 * [Package] resolves an offering role, [PurchaseButton] starts a checkout, [RestorePurchases] reads
 * entitlement state. Putting them in a general-purpose library would push billing concerns into
 * every unrelated consumer of it. The generic half — unknown-node substitution and `schema_version`
 * — does live there, and this model follows the same degradation contract.
 *
 * ## The vocabulary is shared with the server, deliberately
 * `validate_paywall_workflow()` (migration 100) rejects any `type` outside this set at write time.
 * The two lists have to agree: the server is what stops an unrenderable tree from ever being saved,
 * and this is what decides what "renderable" means. Adding a node here without adding it there
 * yields a node the dashboard can never persist; the reverse yields a tree that reaches devices and
 * renders as [Unknown].
 *
 * ## Text lives in [text_lid], never inline (D13)
 * A text-bearing node carries a LOCALIZATION ID, not a string. Re-applying a template then replaces
 * the tree while the tenant's authored copy — which lives in a separate keyed table — survives.
 * Inline strings would make "update from template" either destructive or unmergeable.
 */
sealed interface PaywallNode {

    /** Every node may be conditionally restyled; see [Override]. */
    val overrides: List<Override>

    /** Layout container. [axis] chooses vertical/horizontal/z stacking. */
    data class Stack(
        val axis: Axis = Axis.VERTICAL,
        val components: List<PaywallNode> = emptyList(),
        val spacing: Int = 0,
        val padding: Edges = Edges.ZERO,
        val margin: Edges = Edges.ZERO,
        val backgroundHex: String? = null,
        /** "leading" | "center" | "trailing" — how children align across the stack's cross axis. */
        val horizontalAlignment: String = "leading",
        val cornerRadius: Int = 0,
        val borderHex: String? = null,
        val borderWidth: Int = 0,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /** Text. Resolved through the localization table by [textLid] — never an inline string. */
    data class Text(
        val textLid: String,
        val fontSize: Int = 14,
        val fontWeight: Int = 400,
        val colorHex: String? = null,
        val alignment: String = "leading",
        val padding: Edges = Edges.ZERO,
        val margin: Edges = Edges.ZERO,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    data class Image(
        val url: String?,
        val fitMode: String = "fit",
        val cornerRadius: Int = 0,
        val padding: Edges = Edges.ZERO,
        val margin: Edges = Edges.ZERO,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    data class Icon(
        val name: String,
        val size: Int = 24,
        val tintHex: String? = null,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /**
     * A selectable plan, bound by package ROLE (`$rc_annual`) — never a SKU (D8).
     *
     * Roles survive store migrations, per-platform product ids and price experiments; a SKU pins the
     * tree to one store's catalogue and breaks the moment a second platform ships.
     */
    data class Package(
        val roleIdentifier: String,
        val isSelectedByDefault: Boolean = false,
        val stack: Stack,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /**
     * A button whose job is declared by [action] — the node that makes a MULTI-STEP paywall
     * navigable (D15).
     *
     * Until this existed the renderer pinned `initial_step_id` and every later step was
     * unreachable: the schema, the parser and the server validator all carried steps, and nothing
     * could move between them. `button` was already in the server's accepted vocabulary, so a
     * dashboard could persist a tree whose second screen no device could ever show.
     */
    data class Button(
        val labelLid: String,
        val action: ButtonAction,
        val stack: Stack? = null,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /** Starts checkout for the currently selected [Package]. */
    data class PurchaseButton(
        val labelLid: String,
        val stack: Stack? = null,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    data class RestorePurchases(val labelLid: String, override val overrides: List<Override> = emptyList()) :
        PaywallNode

    /** Footer; `sticky` pins it outside the scrolling body. */
    data class Footer(
        val components: List<PaywallNode> = emptyList(),
        val sticky: Boolean = false,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    data class Timeline(
        val items: List<TimelineItem> = emptyList(),
        val itemSpacing: Int = 12,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    data class TimelineItem(
        val titleLid: String,
        val descriptionLid: String? = null,
        val icon: Icon? = null,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /**
     * Fixed gap, or — when [grow] is set — a flexible one that absorbs the leftover space of its
     * row. That is how a card puts a name at the leading edge and a price at the trailing edge
     * without either being positioned absolutely; without it the two sit adjacent and the layout
     * only looks right at one text length.
     */
    data class Spacer(
        val size: Int = 8,
        val grow: Boolean = false,
        override val overrides: List<Override> = emptyList(),
    ) : PaywallNode

    /**
     * A node this build cannot render (AC-4 / AC-5).
     *
     * Substituted rather than dropped, for the reason the toolkit's UiNode.Unknown documents: a
     * dropped node takes its whole subtree with it, and a dropped ROOT is a blank paywall reported
     * nowhere. Here that would be a paywall with nothing purchasable on a binary the user cannot
     * update — so the shape is preserved and the host decides what to draw.
     */
    data class Unknown(val type: String, override val overrides: List<Override> = emptyList()) : PaywallNode
}

/**
 * What a [PaywallNode.Button] does.
 *
 * Deliberately a closed set rather than a free-form string: a button whose action the SDK does not
 * recognise is a button that does nothing when tapped, which on a paywall is indistinguishable from
 * a broken app. An unparseable action makes the whole node [PaywallNode.Unknown] instead.
 */
sealed interface ButtonAction {
    /** Move to another step of the same workflow. */
    data class NavigateTo(val stepId: String) : ButtonAction

    /** Same as [PaywallNode.PurchaseButton]; lets a multi-step tree put checkout on any screen. */
    data object Purchase : ButtonAction

    data object Restore : ButtonAction
}

enum class Axis { VERTICAL, HORIZONTAL, Z }

/** Uniform edge insets. A single type for margin and padding so the two can never be confused. */
data class Edges(val top: Int = 0, val leading: Int = 0, val bottom: Int = 0, val trailing: Int = 0) {
    companion object {
        val ZERO = Edges()
    }
}

/**
 * A conditional restyle of the node that carries it (D14).
 *
 * Every condition must hold for [properties] to apply. This keeps trial-vs-regular copy and
 * selected-package styling in DATA: without it each variant is a branch in the renderer, which is
 * how a "template" ends up being code that only its author can change.
 */
data class Override(val conditions: List<Condition>, val properties: Map<String, String>)

/** The condition vocabulary; mirrors what the dashboard can author. */
enum class Condition(val wire: String) {
    /** An introductory offer (free trial / discounted first period) is available for this package. */
    INTRO_OFFER("intro_offer"),

    /** This package is the currently selected one. */
    SELECTED("selected"),
    ;

    companion object {
        fun from(wire: String): Condition? = entries.firstOrNull { it.wire == wire }
    }
}
