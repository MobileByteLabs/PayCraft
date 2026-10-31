package com.mobilebytelabs.paycraft.presentation.tree

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_save
import com.mobilebytelabs.paycraft.generated.resources.paycraft_popular_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_cta
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_disclosure_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_disclosure_title
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.resolveTrialCopy
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * Renders a server-authored [PaywallWorkflow] with Compose.
 *
 * ## The contract with the rest of the paywall
 * This composable draws; it does not decide. Selection, checkout and restore are raised through
 * [onSelectPackage] / [onPurchase] / [onRestore] so the existing PayCraftPaywallViewModel keeps
 * owning billing state. A renderer that reached into billing directly could not be previewed in the
 * dashboard, in `@Preview`, or in a Roborazzi golden — and those three are how this gets verified.
 *
 * ## Unknown nodes render as nothing, visibly by choice
 * [PaywallNode.Unknown] draws an empty box rather than a placeholder. The substitution already did
 * its job at parse time by preserving the tree's SHAPE (siblings keep their order and spacing); a
 * visible "unsupported" chip on a live paywall would be worse than a gap, because the user cannot
 * act on it and it sits next to the price. Hosts that want a debug affordance can branch on the type.
 */
@Composable
fun PaywallTreeContent(
    workflow: PaywallWorkflow,
    context: RenderContext,
    modifier: Modifier = Modifier,
    priceFor: (role: String) -> PackagePrice? = { null },
    onSelectPackage: (role: String) -> Unit = {},
    onPurchase: () -> Unit = {},
    onRestore: () -> Unit = {},
) {
    // Which step is on screen. A multi-step paywall (D15) moves between them via a `button` node
    // with a `navigate_to` action; a single-step tree never leaves its first.
    var stepId by remember(workflow) { mutableStateOf(workflow.initialStepId) }
    val step = workflow.steps.firstOrNull { it.id == stepId }
        ?: workflow.initialStep
        ?: return
    val root = step.root ?: return
    // Defaults derived from the tree's declared scheme, NOT from the host's. A dark tree rendered
    // inside a light host must still be readable — the author declared the design, the host merely
    // happens to be running.
    val surface = if (workflow.isDark) Color(0xFF121212) else PayCraftTheme.colors.surface
    val onSurface = if (workflow.isDark) Color(0xFFF2F2F2) else PayCraftTheme.colors.onSurface
    val onSurfaceVariant = if (workflow.isDark) Color(0xFFB8B8B8) else PayCraftTheme.colors.onSurfaceVariant
    // WIDTH is filled, HEIGHT wraps — the host owns the bounds (see `paywallRoot`). `fillMaxSize`
    // here made a sheet-mode paywall paint edge-to-edge over the app behind it, which is the whole
    // property sheet mode exists to preserve.
    // Width is filled, height WRAPS — the frame owns the bounds and the scrolling (see
    // `PaywallStateHost`'s frame box). The tree is pure content: it is server-authored and its
    // height is unknowable here, so deciding how overflow is reached is not its call to make.
    // Which plan wears the POPULAR chip — one at most, decided once for the step.
    val popularRole = remember(root, context) { root.popularRole(context) }
    CompositionLocalProvider(LocalPopularRole provides popularRole) {
        Column(modifier = modifier.fillMaxWidth().background(surface)) {
            RenderNode(
                node = root,
                workflow = workflow,
                context = context,
                onSurface = onSurface,
                onSurfaceVariant = onSurfaceVariant,
                owningPackageRole = null,
                priceFor = priceFor,
                onSelectPackage = onSelectPackage,
                onPurchase = onPurchase,
                onRestore = onRestore,
                onNavigate = { target ->
                    // Navigating to a step that does not exist is ignored rather than blanking the
                    // paywall: the tree came off a server, and a dangling destination must not be able
                    // to strand a paying customer on an empty screen.
                    if (workflow.steps.any { it.id == target }) stepId = target
                },
            )
            // BRANDING AND LEGAL ARE NOT PART OF THE TREE, and must not be.
            //
            // The tree is tenant-authored; attribution is a plan obligation and reachable Terms/Privacy
            // is a store one. If either were a node, a tenant could delete it — deliberately or by
            // starting from a template that never had one — and the paywall would ship without what its
            // tier and its store require, with nothing failing.
            //
            // Both now render in the FRAME (`PaywallStateHost`'s footer chrome), which is also what gives
            // them their bottom inset: as the last rows of this scrolling column they sat against the
            // gesture bar.
        }
    }
}

/**
 * What a package costs, resolved at render time.
 *
 * [savingsPercent] and [perPeriodNote] are DERIVED from the catalogue rather than authored, so a
 * price change cannot leave a stale "SAVE 50%" chip behind on a live paywall.
 */
/**
 * What a package costs, as the paywall should SAY it.
 *
 * [trialDays] carries the catalogue's trial so authored copy can reference it as a variable rather
 * than spelling the number. cappy's published paywall said "Best value · 7-day free trial" as a
 * LITERAL while the catalogue promised 14 — the paywall copy was a second source of truth and it
 * was the one the buyer read. A variable cannot drift from the catalogue; a sentence can.
 */
data class PackagePrice(
    val display: String,
    val perPeriodNote: String? = null,
    val savingsPercent: Int? = null,
    val trialDays: Int? = null,
    /**
     * The plan card's compact sub-line under the price: the monthly anchor ("$3.33 / mo") for longer
     * plans, else the cadence ("/ month", "one-time"). Optional — without it the card falls back to
     * [perPeriodNote]. Kept separate because [perPeriodNote] also feeds authored copy variables.
     */
    val periodLabel: String? = null,
)

@Composable
private fun RenderNode(
    node: PaywallNode,
    workflow: PaywallWorkflow,
    context: RenderContext,
    onSurface: Color,
    onSurfaceVariant: Color,
    owningPackageRole: String?,
    priceFor: (String) -> PackagePrice?,
    onSelectPackage: (String) -> Unit,
    onPurchase: () -> Unit,
    onRestore: () -> Unit,
    onNavigate: (String) -> Unit,
    /**
     * `Modifier.weight(1f)` from the enclosing Row/Column, or null when there is no such scope.
     * `weight` is a scope extension, so a flexible spacer cannot build it itself — the parent
     * stack, which HAS the scope, passes one down to whichever child asks to grow.
     */
    growModifier: Modifier? = null,
    /**
     * Axis of the stack this node sits in. Only text needs it, and it needs it badly: `textAlign`
     * does nothing unless the text is wider than its content, so a vertically-stacked text takes
     * `fillMaxWidth` to make center/trailing alignment mean anything. In a ROW that same modifier
     * makes every text demand the whole row — the name, the savings chip and the price each ask for
     * full width, and the row divides what is left, which renders a price one character per line.
     */
    parentAxis: Axis = Axis.VERTICAL,
) {
    // Conditional restyle resolved ONCE per node, then read for every property below (D14).
    val props = node.effectiveProperties(context, owningPackageRole)

    /** Token first, literal hex second — see [treeTokenColorOrNull]. */
    val paycraftColors = PayCraftTheme.colors
    fun themed(raw: String?): Color? = treeTokenColorOrNull(raw, paycraftColors) ?: treeColorOrNull(raw)

    /**
     * A lid may be swapped by an override — e.g. trial copy replacing the regular headline — and
     * the resolved copy may carry `{{ product.price }}` variables, substituted against the price of
     * the package this node sits inside (null outside any package, so the variable resolves empty).
     */
    fun text(lid: String, key: String = "text_lid"): String = substituteVariables(
        workflow.resolve(props[key] ?: lid, context.locale),
        owningPackageRole?.let(priceFor),
    )

    // A node whose content all substitutes away is skipped WITH its decoration — see rendersNothing.
    // Checked before the `when` so it covers text and stacks alike, and so a skipped stack never
    // measures its children.
    if (node is PaywallNode.Text || node is PaywallNode.Stack) {
        if (node.rendersNothing(workflow, context, owningPackageRole?.let(priceFor))) return
    }

    when (node) {
        is PaywallNode.Stack -> {
            val shape = RoundedCornerShape(node.cornerRadius.dp)
            // A stack that directly holds plans is the product list. The tag names the ROLE rather
            // than a specific composable, which is what lets the tree satisfy assertions written
            // against ProductList without re-introducing ProductList.
            val holdsPackages = node.components.any { it is PaywallNode.Package }
            var mod = Modifier
                .then(if (holdsPackages) Modifier.testTag(PayCraftTestTags.PRODUCT_LIST) else Modifier)
                .padding(node.margin.toPadding())
                .then(if (node.axis == Axis.VERTICAL) Modifier.fillMaxWidth() else Modifier)
            themed(props["background"] ?: node.backgroundHex)?.let { mod = mod.background(it, shape) }
            // Border reads overrides the same way background does. Without this a `selected`
            // override can only tint a card, never ring it — and a ring is how every plan selector
            // in the wild signals which package the CTA will actually buy.
            val borderWidth = props["border_width"]?.toIntOrNull() ?: node.borderWidth
            themed(props["border"] ?: node.borderHex)?.takeIf { borderWidth > 0 }?.let {
                mod = mod.border(borderWidth.dp, it, shape)
            }
            mod = mod.padding(node.padding.toPadding())

            val kids: @Composable (Modifier?) -> Unit = { grow ->
                node.components.forEach {
                    RenderNode(
                        it,
                        workflow,
                        context,
                        onSurface,
                        onSurfaceVariant,
                        owningPackageRole,
                        priceFor,
                        onSelectPackage,
                        onPurchase,
                        onRestore,
                        onNavigate,
                        grow,
                        node.axis,
                    )
                }
            }
            when (node.axis) {
                Axis.VERTICAL -> Column(
                    mod,
                    verticalArrangement = Arrangement.spacedBy(node.spacing.dp),
                    horizontalAlignment = when (node.horizontalAlignment) {
                        "center" -> Alignment.CenterHorizontally
                        "trailing" -> Alignment.End
                        else -> Alignment.Start
                    },
                ) { kids(Modifier.weight(1f)) }
                Axis.HORIZONTAL -> Row(
                    mod,
                    horizontalArrangement = Arrangement.spacedBy(node.spacing.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) { kids(Modifier.weight(1f)) }
                Axis.Z -> Box(mod, contentAlignment = Alignment.Center) { kids(null) }
            }
        }

        is PaywallNode.Text -> Text(
            text = text(node.textLid),
            color = themed(props["color"] ?: node.colorHex) ?: onSurface,
            fontSize = (props["font_size"]?.toIntOrNull() ?: node.fontSize).sp,
            fontWeight = FontWeight(props["font_weight_int"]?.toIntOrNull() ?: node.fontWeight),
            textAlign = when (node.alignment) {
                "center" -> TextAlign.Center
                "trailing" -> TextAlign.End
                else -> TextAlign.Start
            },
            modifier = Modifier
                .then(if (parentAxis == Axis.HORIZONTAL) Modifier else Modifier.fillMaxWidth())
                .padding(node.margin.toPadding())
                .padding(node.padding.toPadding()),
        )

        is PaywallNode.Package -> {
            // A plan the tenant does not sell is not rendered. The templates got this for free by
            // iterating PRODUCTS; a tree authors its packages up front, so a tenant selling only
            // monthly would otherwise show an inert annual row taking the space the CTA needs.
            //
            // Availability is DECLARED by the caller, not inferred from a null price: a dashboard
            // preview and an authoring canvas have no prices at all and must still show every plan.
            // Null means "show them all", which is what every non-app caller wants.
            if (context.availableRoles?.contains(node.roleIdentifier) == false) return
            // `recommended` comes from the v1 `popularPlanSku` bridge (and is authorable by any
            // tree). The TAG sits on the non-clickable outer node deliberately, matching what
            // ProductList established: a tag on the clickable would make "is it recommended" and
            // "did the tap land" the same assertion.
            val recommended = props["recommended"] == "true"
            val price = priceFor(node.roleIdentifier)
            val (title, subtitle) = node.cardCopy(workflow, context, price)
            Box(
                Modifier
                    .fillMaxWidth()
                    .then(
                        if (recommended) {
                            Modifier.testTag(PayCraftTestTags.PRODUCT_LIST_RECOMMENDED)
                        } else {
                            Modifier
                        },
                    ),
            ) {
                PlanCard(
                    title = title,
                    subtitle = subtitle,
                    price = price,
                    selected = context.selectedPackageRole == node.roleIdentifier,
                    popular = LocalPopularRole.current == node.roleIdentifier,
                    onSurface = onSurface,
                    onSurfaceVariant = onSurfaceVariant,
                    onClick = { onSelectPackage(node.roleIdentifier) },
                )
            }
        }

        is PaywallNode.Button -> Button(
            onClick = {
                when (val a = node.action) {
                    is ButtonAction.NavigateTo -> onNavigate(a.stepId)
                    ButtonAction.Purchase -> onPurchase()
                    ButtonAction.Restore -> onRestore()
                }
            },
            shape = RoundedCornerShape(26.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = PayCraftTheme.colors.accent,
                contentColor = PayCraftTheme.colors.onAccent,
            ),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(text(node.labelLid)) }

        is PaywallNode.PurchaseButton -> Column(Modifier.fillMaxWidth()) {
            // The trial is the CATALOGUE's statement about the SELECTED plan, read at render time —
            // never authored copy, which is how cappy's paywall promised 7 days while selling 14.
            // Play policy wants the terms beside the CTA, so the disclosure renders here, and the
            // CTA names the trial the tap actually starts.
            val trialDays = context.selectedPackageRole?.let(priceFor)?.trialDays?.takeIf { it > 0 }
            if (trialDays != null) {
                TrialDisclosure(days = trialDays, onSurface = onSurface, onSurfaceVariant = onSurfaceVariant)
                Spacer(Modifier.height(20.dp))
            }
            Button(
                onClick = onPurchase,
                shape = RoundedCornerShape(28.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = PayCraftTheme.colors.accent,
                    contentColor = PayCraftTheme.colors.onAccent,
                ),
                // The dominant CTA, named. Callers assert there is exactly ONE of these on a paywall;
                // a tree with two purchase buttons is an authoring mistake worth failing on.
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(PayCraftTestTags.PAYWALL_CTA)
                    .padding(node.stack?.margin?.toPadding() ?: PaddingValues(0.dp))
                    // The dominant CTA is a 56dp pill everywhere the SDK draws one (Stitch sdk-paywall).
                    .heightIn(min = 56.dp),
            ) {
                Text(
                    text = if (trialDays != null) {
                        stringResource(Res.string.paycraft_trial_cta, trialDays)
                    } else {
                        text(node.labelLid)
                    },
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        is PaywallNode.RestorePurchases -> TextButton(
            onClick = onRestore,
            modifier = Modifier.fillMaxWidth(),
        ) {
            // Uppercase + letterspacing is the templates' micro-footer treatment; matching it here
            // keeps a converted template visually identical to the one it replaces.
            Text(
                text = text(node.labelLid).uppercase(),
                color = onSurfaceVariant,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.2.sp,
            )
        }

        is PaywallNode.Footer -> Column(Modifier.fillMaxWidth()) {
            node.components.forEach {
                RenderNode(
                    it,
                    workflow,
                    context,
                    onSurface,
                    onSurfaceVariant,
                    owningPackageRole,
                    priceFor,
                    onSelectPackage,
                    onPurchase,
                    onRestore,
                    onNavigate,
                )
            }
        }

        is PaywallNode.Timeline -> Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(node.itemSpacing.dp),
        ) {
            node.items.forEach {
                RenderNode(
                    it,
                    workflow,
                    context,
                    onSurface,
                    onSurfaceVariant,
                    owningPackageRole,
                    priceFor,
                    onSelectPackage,
                    onPurchase,
                    onRestore,
                    onNavigate,
                )
            }
        }

        is PaywallNode.TimelineItem -> Column(Modifier.fillMaxWidth()) {
            Text(
                text = text(node.titleLid, "title_lid"),
                color = onSurface,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
            )
            node.descriptionLid?.let {
                Text(
                    text = workflow.resolve(it, context.locale),
                    color = onSurfaceVariant,
                    fontSize = 14.sp,
                )
            }
        }

        is PaywallNode.Icon -> {
            // The template's hero tile, not a re-implementation: same 20.dp corner, same 12%-accent
            // fill, same brand-tinted glyph. An earlier pass stubbed this as a Spacer, which is why
            // the seed tree rendered with no hero icon while the template showed one.
            val tint = treeColorOrNull(props["color"] ?: node.tintHex) ?: PayCraftTheme.colors.accent
            Box(
                modifier = Modifier
                    .size(node.size.dp)
                    .clip(RoundedCornerShape((node.size / 3.6f).dp))
                    .background(PayCraftTheme.colors.accent.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Star,
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size((node.size * 0.55f).dp),
                )
            }
        }

        // Remote images are NOT rendered: cmp-paycraft ships no image-loading dependency, and
        // adding one (coil/kamel) to a billing SDK is a dependency decision for the release train,
        // not something to smuggle in through a renderer. The node reserves its layout slot so the
        // surrounding geometry matches a build that can load it.
        is PaywallNode.Image -> Spacer(Modifier.height(0.dp))

        is PaywallNode.Spacer -> Spacer(
            if (node.grow) {
                growModifier ?: Modifier.height(node.size.dp)
            } else {
                Modifier.height(node.size.dp)
            },
        )

        // See the class KDoc: shape was already preserved at parse time; drawing a visible
        // "unsupported" marker next to a price would be worse than the gap.
        is PaywallNode.Unknown -> Box(Modifier)
    }
}

private fun Edges.toPadding() = PaddingValues(
    start = leading.dp,
    top = top.dp,
    end = trailing.dp,
    bottom = bottom.dp,
)

// ── Plan card (Stitch sdk-paywall 02/03/10/11) ──────────────────────────────────────────────────
//
// CARD ANATOMY IS PRESENTATION, so the renderer owns it for EVERY package node — the bundled seeds
// and every published tenant tree alike, with no data migration. What a tree authors inside a
// package is its COPY (the plan name and its note); what the SDK draws is the card: a leading radio
// that reflects the VM's selection, an outline (unselected) or accent ring (selected), the price
// block right-aligned with its per-period line, a SAVE badge straddling the top edge, and a POPULAR
// chip beside the title. Every one of those facts comes from data the render already has — the
// selection, `PackagePrice` (derived from the catalogue), and the package's `recommended` /
// `is_selected_by_default` flags — never from the tree's own styling, so a price change can never
// leave a stale badge and a tree can never draw two different-looking plan lists.

/** The plan that wears POPULAR for the current step; provided once by [PaywallTreeContent]. */
private val LocalPopularRole = staticCompositionLocalOf<String?> { null }

/** The variables the card chrome renders itself; a text built from these is not the plan's copy. */
private val CHROME_VARIABLES =
    Regex("""\{\{\s*product\.(price|price_per_period|offer_savings|offer_savings_label)\s*\}\}""")

/**
 * POPULAR goes to the package the tenant marked `recommended` (v1 `popularPlanSku` bridge, or an
 * authored override); failing that, to the one the tree preselects (`is_selected_by_default` — the
 * plan the author chose to lead with). At most one, and never on a single-plan paywall, where
 * "popular" compares the plan to nothing.
 */
internal fun PaywallNode.popularRole(context: RenderContext): String? {
    val packages = mutableListOf<PaywallNode.Package>()
    fun walk(n: PaywallNode?) {
        when (n) {
            is PaywallNode.Package -> packages += n
            is PaywallNode.Stack -> n.components.forEach(::walk)
            is PaywallNode.Footer -> n.components.forEach(::walk)
            else -> Unit
        }
    }
    walk(this)
    val sold = packages.filter { context.availableRoles?.contains(it.roleIdentifier) != false }
    if (sold.size < 2) return null
    return (
        sold.firstOrNull { it.effectiveProperties(context, it.roleIdentifier)["recommended"] == "true" }
            ?: sold.firstOrNull { it.isSelectedByDefault }
        )?.roleIdentifier
}

/**
 * The plan's COPY out of its authored stack: the first text is the title, the rest join into the
 * note line. Texts that only carry price/savings variables are skipped — the card draws those in
 * their fixed slots, and drawing them twice is the duplicate-price bug in another shape.
 */
internal fun PaywallNode.Package.cardCopy(
    workflow: PaywallWorkflow,
    context: RenderContext,
    price: PackagePrice?,
): Pair<String?, String?> {
    val copy = mutableListOf<String>()
    fun walk(n: PaywallNode) {
        when (n) {
            is PaywallNode.Stack -> n.components.forEach(::walk)
            is PaywallNode.Text -> {
                val lid = n.effectiveProperties(context, roleIdentifier)["text_lid"] ?: n.textLid
                val raw = workflow.resolve(lid, context.locale)
                if (!CHROME_VARIABLES.containsMatchIn(raw)) {
                    substituteVariables(raw, price).trim().takeIf { it.isNotEmpty() }?.let(copy::add)
                }
            }
            else -> Unit
        }
    }
    walk(stack)
    return copy.firstOrNull() to copy.drop(1).joinToString(" · ").ifBlank { null }
}

@Composable
private fun PlanCard(
    title: String?,
    subtitle: String?,
    price: PackagePrice?,
    selected: Boolean,
    popular: Boolean,
    onSurface: Color,
    onSurfaceVariant: Color,
    onClick: () -> Unit,
) {
    val colors = PayCraftTheme.colors
    val shape = RoundedCornerShape(16.dp)
    val savings = price?.savingsPercent?.takeIf { it > 0 }
    Box(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // Room for the badge that straddles the top edge.
                .padding(top = if (savings != null) BADGE_HALF_HEIGHT else 0.dp)
                .clip(shape)
                .background(if (selected) colors.accent.copy(alpha = 0.08f) else onSurface.copy(alpha = 0.03f))
                .border(
                    width = if (selected) 2.dp else 1.dp,
                    color = if (selected) colors.accent else onSurface.copy(alpha = 0.14f),
                    shape = shape,
                )
                .testTag(PayCraftTestTags.PRODUCT_LIST_ITEM)
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioMark(selected = selected, idle = onSurfaceVariant)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (title != null) {
                        Text(
                            text = title,
                            color = onSurface,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                    if (popular) {
                        Spacer(Modifier.width(8.dp))
                        PopularChip()
                    }
                }
                if (subtitle != null) {
                    Spacer(Modifier.height(2.dp))
                    Text(text = subtitle, color = onSurfaceVariant, fontSize = 14.sp)
                }
            }
            if (price != null) {
                Spacer(Modifier.width(12.dp))
                // Capped so a long cadence note wraps under the price instead of crushing the plan name.
                Column(Modifier.widthIn(max = 150.dp), horizontalAlignment = Alignment.End) {
                    Text(text = price.display, color = onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    (price.periodLabel ?: price.perPeriodNote)?.let {
                        Text(
                            text = it,
                            color = if (selected) colors.accent else onSurfaceVariant,
                            fontSize = 13.sp,
                            textAlign = TextAlign.End,
                        )
                    }
                }
            }
        }
        if (savings != null) {
            Text(
                text = stringResource(Res.string.paycraft_plan_save, "$savings%"),
                color = colors.onAccent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = 20.dp)
                    .clip(RoundedCornerShape(50))
                    .background(colors.accent)
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
    }
}

@Composable
private fun RadioMark(selected: Boolean, idle: Color) {
    val colors = PayCraftTheme.colors
    Box(
        modifier = Modifier
            .size(22.dp)
            .clip(CircleShape)
            .then(
                if (selected) {
                    Modifier.background(colors.accent)
                } else {
                    Modifier.border(2.dp, idle.copy(alpha = 0.5f), CircleShape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Box(Modifier.size(8.dp).clip(CircleShape).background(colors.onAccent))
    }
}

@Composable
private fun PopularChip() {
    val accent = PayCraftTheme.colors.accent
    Text(
        text = stringResource(Res.string.paycraft_popular_badge).uppercase(),
        color = accent,
        maxLines = 1,
        softWrap = false,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.5.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(accent.copy(alpha = 0.12f))
            .border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/**
 * Trial terms beside the CTA (Stitch content-trial; Play policy). Copy is the tenant's dashboard
 * template when set, else the SDK default — through the same compliance-checked resolver the
 * product list uses.
 */
@Composable
private fun TrialDisclosure(days: Int, onSurface: Color, onSurfaceVariant: Color) {
    val paywall = LocalPayCraftConfig.current?.paywall
    val title = resolveTrialCopy(
        template = paywall?.trialDisclosureTitle.orEmpty(),
        fallback = stringResource(Res.string.paycraft_trial_disclosure_title),
        days = days,
        price = null,
        requirePrice = false,
    )
    val body = resolveTrialCopy(
        template = paywall?.trialDisclosureBody.orEmpty(),
        fallback = stringResource(Res.string.paycraft_trial_disclosure_body),
        days = days,
        price = null,
        requirePrice = false,
    )
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(onSurface.copy(alpha = 0.03f))
            .border(1.dp, onSurface.copy(alpha = 0.14f), shape)
            .padding(16.dp)
            .testTag(PayCraftTestTags.PRODUCT_LIST_TRIAL_TERMS),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Outlined.VerifiedUser,
                contentDescription = null,
                tint = PayCraftTheme.colors.accent,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(text = title, color = onSurface, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(8.dp))
        Text(text = body, color = onSurfaceVariant, fontSize = 13.sp, lineHeight = 19.sp)
    }
}

private val BADGE_HALF_HEIGHT = 11.dp
