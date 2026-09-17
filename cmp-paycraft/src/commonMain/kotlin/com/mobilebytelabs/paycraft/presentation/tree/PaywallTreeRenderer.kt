package com.mobilebytelabs.paycraft.presentation.tree

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

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

/**
 * What a package costs, resolved at render time.
 *
 * [savingsPercent] and [perPeriodNote] are DERIVED from the catalogue rather than authored, so a
 * price change cannot leave a stale "SAVE 50%" chip behind on a live paywall.
 */
data class PackagePrice(val display: String, val perPeriodNote: String? = null, val savingsPercent: Int? = null)

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
            // NOTE: there is deliberately no `selected` branch here. Selection styling is DATA —
            // a `selected` override on the package's stack (see the seed trees) — so a tenant can
            // restyle it without an SDK release. A renderer branch would hardcode one look.
            // `recommended` comes from the v1 `popularPlanSku` bridge (and is authorable by any
            // tree). The TAG sits on this non-clickable outer node deliberately, matching what
            // ProductList established: a tag on the clickable would make "is it recommended" and
            // "did the tap land" the same assertion.
            val recommended = props["recommended"] == "true"
            // Two tags, two nodes — deliberately. Stacking `.testTag(a).testTag(b)` on one chain
            // keeps only the outermost, which silently dropped RECOMMENDED. It also matches what
            // ProductList documented: RECOMMENDED belongs on a non-clickable wrapper so that "is
            // this plan recommended" and "did the tap land" never become the same assertion.
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
                Box(
                    Modifier
                        .fillMaxWidth()
                        .testTag(PayCraftTestTags.PRODUCT_LIST_ITEM)
                        .clickable { onSelectPackage(node.roleIdentifier) },
                ) {
                    // The child stack is rendered with THIS package as the owning role, which is what
                    // makes a `selected` override apply to one card instead of all of them.
                    RenderNode(
                        node = node.stack,
                        workflow = workflow,
                        context = context,
                        onSurface = onSurface,
                        onSurfaceVariant = onSurfaceVariant,
                        owningPackageRole = node.roleIdentifier,
                        priceFor = priceFor,
                        onSelectPackage = onSelectPackage,
                        onPurchase = onPurchase,
                        onRestore = onRestore,
                        onNavigate = onNavigate,
                    )
                    // FALLBACK ONLY. A card that prices itself — any descendant text carrying a
                    // `{{ product.* }}` variable — lays its own price out, inside its own bounds. This
                    // corner overlay exists for trees authored before variables existed, which would
                    // otherwise show a plan with no price at all. It is deliberately not the default:
                    // being outside the stack, it is not part of the card's measured height, so it
                    // escapes the card's background and border.
                    if (!node.stack.pricesItself(workflow, context)) {
                        priceFor(node.roleIdentifier)?.let { price ->
                            Column(
                                modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
                                horizontalAlignment = Alignment.End,
                            ) {
                                // The "SAVE n%" chip the template draws inside ProductList. Authored
                                // nowhere — derived from the prices themselves, so it cannot go stale.
                                price.savingsPercent?.let { pct ->
                                    Text(
                                        text = "SAVE $pct%",
                                        color = PayCraftTheme.colors.onPopularBadge,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .background(PayCraftTheme.colors.popularBadge, RoundedCornerShape(6.dp))
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                                Text(
                                    text = price.display,
                                    color = onSurface,
                                    fontSize = 14.sp,
                                )
                                price.perPeriodNote?.let {
                                    Text(it, color = onSurfaceVariant, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
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

        is PaywallNode.PurchaseButton -> Button(
            onClick = onPurchase,
            shape = RoundedCornerShape(26.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = PayCraftTheme.colors.accent,
                contentColor = PayCraftTheme.colors.onAccent,
            ),
            // The dominant CTA, named. Callers assert there is exactly ONE of these on a paywall;
            // a tree with two purchase buttons is an authoring mistake worth failing on.
            modifier = Modifier
                .fillMaxWidth()
                .testTag(PayCraftTestTags.PAYWALL_CTA)
                .padding(node.stack?.margin?.toPadding() ?: PaddingValues(0.dp)),
        ) { Text(text(node.labelLid)) }

        is PaywallNode.RestorePurchases -> TextButton(
            onClick = onRestore,
            modifier = Modifier.fillMaxWidth(),
        ) {
            // Uppercase + letterspacing is the templates' micro-footer treatment; matching it here
            // keeps a converted template visually identical to the one it replaces.
            Text(
                text = text(node.labelLid).uppercase(),
                color = onSurfaceVariant,
                fontSize = 11.sp,
                letterSpacing = 0.8.sp,
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
