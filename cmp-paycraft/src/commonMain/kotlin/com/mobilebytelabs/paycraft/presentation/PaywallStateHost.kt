package com.mobilebytelabs.paycraft.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.productForRole
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeContent
import com.mobilebytelabs.paycraft.presentation.tree.PaywallWorkflow
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.presentation.tree.withV1Config
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.components.DeviceConflictContent
import com.mobilebytelabs.paycraft.ui.components.OwnershipVerifiedContent
import com.mobilebytelabs.paycraft.ui.components.PaymentPendingContent
import com.mobilebytelabs.paycraft.ui.components.PaywallChromeFooter
import com.mobilebytelabs.paycraft.ui.components.PaywallErrorContent
import com.mobilebytelabs.paycraft.ui.components.PaywallInlineError
import com.mobilebytelabs.paycraft.ui.components.PremiumEntitlementActions
import com.mobilebytelabs.paycraft.ui.components.PremiumStatusContent
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.paywallContentSize
import com.mobilebytelabs.paycraft.ui.paywallRoot
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * The paywall's state machine, once — replacing the copy each of the four templates carried.
 *
 * ## What the templates actually were
 * `BrandedStackTemplate`, `MinimalTemplate`, `DarkTemplate` and `PremiumTemplate` each owned a
 * `when (state)` over all seven [BillingState] arms. Six of those arms were effectively identical:
 * Loading was `PaywallSkeleton` in all four; PaymentPending, DeviceConflict and OwnershipVerified
 * already delegated to the same shared components; Premium and Error differed only in wording no
 * tenant chose and none could change. Only the **Free** arm — the paywall itself — genuinely varied,
 * and that is precisely the part a component tree expresses.
 *
 * So the four templates were one state machine plus four layouts. This is the state machine; the
 * layouts are seed trees ([BuiltInPaywallSeeds]), and a tenant's published tree replaces them
 * without an app update.
 *
 * ## Why the Free arm can render nothing
 * [workflow] is null only if the tenant published no tree AND the bundled seed failed to load —
 * a corrupt install. The error surface with a retry is shown rather than a blank sheet, because a
 * paywall that renders empty looks like a layout bug and gets dismissed; one that says something is
 * wrong gets retried.
 */
@Composable
fun PaywallStateHost(
    state: BillingState,
    workflow: PaywallWorkflow?,
    context: RenderContext,
    priceFor: (String) -> PackagePrice?,
    onSelectPackage: (String) -> Unit,
    onPurchase: () -> Unit,
    onRestore: () -> Unit,
    onRetry: () -> Unit,
    onAction: (PayCraftPaywallAction) -> Unit,
    /**
     * Carry the tenant's v1 dashboard settings (`valueProps`, `popularPlanSku`) into [workflow].
     *
     * True only when [workflow] is a BUILT-IN SEED. A tenant who authored their own tree expressed
     * their design deliberately — including the choice to show no value props — and injecting
     * config-driven nodes into it would override that.
     */
    enrichFromConfig: Boolean = true,
) {
    // A tree that declares `color_scheme: dark` imposes it on EVERY arm, not just its own.
    //
    // Ported from DarkTemplate, which learned this the hard way: the shared state composables
    // (DeviceConflictContent, OwnershipVerifiedContent, PremiumEntitlementActions) read ambient
    // MaterialTheme.colorScheme, so under a light host they painted dark-grey `onSurfaceVariant`
    // onto a near-black background — text that is technically rendered and effectively invisible.
    // Scoping the dark scheme to the Free arm would recreate exactly that bug for a dark-tree tenant
    // the moment their device hit a conflict.
    val dark = workflow?.isDark == true
    val scheme = if (dark) {
        darkColorScheme(
            surface = DARK_SURFACE,
            onSurface = DARK_ON_SURFACE,
            surfaceVariant = DARK_SURFACE,
            onSurfaceVariant = DARK_ON_SURFACE,
            background = DARK_SURFACE,
            onBackground = DARK_ON_SURFACE,
        )
    } else {
        MaterialTheme.colorScheme
    }

    MaterialTheme(colorScheme = scheme) {
        // ── THE FRAME BOX ────────────────────────────────────────────────────────────────────────
        // Everything the paywall renders is server-authored, so the FRAME is the only part of this
        // screen whose shape is known at build time. It owns exactly three things and no content:
        // the BOUNDS (`paywallRoot` — full window, or wrap-height inside a sheet), the SURFACE it
        // paints, and the SCROLL.
        //
        // Scrolling belongs here rather than in any arm below. Every arm can overflow — a tree with a
        // third plan card, a long error message, a device-conflict explanation — and each one solving
        // it separately means each one can forget, which is how a purchase button ends up below the
        // fold with no way to reach it (production, cappy, three plan cards). One container, and the
        // question is settled for every state the paywall can be in.
        //
        // `paywallContentSize` exists for precisely this column: it sizes without painting, so a
        // scrolling body inside a wrap-height sheet cannot force the sheet to full height.
        Box(Modifier.paywallRoot(if (dark) DARK_SURFACE else PayCraftTheme.colors.surface)) {
            Column(
                modifier = Modifier
                    .paywallContentSize()
                    .verticalScroll(rememberScrollState()),
            ) {
                when (state) {
                    is BillingState.Loading -> PaywallSkeleton(planCount = 3)

                    is BillingState.Free ->
                        if (workflow != null) {
                            FreeArm(
                                workflow = workflow,
                                context = context,
                                priceFor = priceFor,
                                onSelectPackage = onSelectPackage,
                                onPurchase = onPurchase,
                                onRestore = onRestore,
                                enrichFromConfig = enrichFromConfig,
                            )
                        } else {
                            PaywallErrorContent(
                                message = "This paywall could not be loaded.",
                                onRetry = onRetry,
                            )
                        }

                    is BillingState.Premium -> Column {
                        PremiumStatusContent(state)
                        PremiumEntitlementActions(onAction)
                    }

                    // A purchase that failed is not a paywall that failed. When there is still something
                    // to render — a tree — the error is a banner ABOVE the plans, so the customer can pick
                    // a different plan or simply try again. Only a paywall that cannot render at all gets
                    // the full-screen treatment.
                    is BillingState.Error ->
                        if (workflow != null) {
                            Column {
                                PaywallInlineError(state.message, onRetry)
                                FreeArm(
                                    workflow = workflow,
                                    context = context,
                                    priceFor = priceFor,
                                    onSelectPackage = onSelectPackage,
                                    onPurchase = onPurchase,
                                    onRestore = onRestore,
                                    enrichFromConfig = enrichFromConfig,
                                )
                            }
                        } else {
                            PaywallErrorContent(state.message, onRetry)
                        }
                    is BillingState.PaymentPending -> PaymentPendingContent(state.productId)
                    is BillingState.DeviceConflict -> DeviceConflictContent(state, onAction)
                    is BillingState.OwnershipVerified -> OwnershipVerifiedContent(state, onAction)
                }

                // Footer chrome closes the frame for EVERY state above. It scrolls with the body rather
                // than pinning, because a paywall this short would otherwise reserve a strip of dead space
                // above the fold on a tall screen — and once the body scrolls at all, reaching the footer is
                // the same gesture as reaching the purchase button.
                val paywall = LocalPayCraftConfig.current?.paywall
                PaywallChromeFooter(
                    termsUrl = paywall?.termsUrl,
                    privacyUrl = paywall?.privacyUrl,
                    branding = paywall?.branding ?: "attribution",
                    customFooter = paywall?.customFooter,
                )
            }
        }
    }
}

/** The dark palette DarkTemplate painted, kept identical so a dark tenant sees no shift. */
private val DARK_SURFACE = Color(0xFF121212)
private val DARK_ON_SURFACE = Color(0xFFF2F2F2)

/**
 * The purchasable surface. Extracted so the Free arm and the Error arm render the SAME paywall
 * rather than two copies that can drift — the Error arm shows it under a banner.
 */
@Composable
private fun FreeArm(
    workflow: PaywallWorkflow,
    context: RenderContext,
    priceFor: (String) -> PackagePrice?,
    onSelectPackage: (String) -> Unit,
    onPurchase: () -> Unit,
    onRestore: () -> Unit,
    enrichFromConfig: Boolean,
) {
    val config = LocalPayCraftConfig.current
    val effective = remember(workflow, config, enrichFromConfig) {
        val paywall = config?.paywall
        if (!enrichFromConfig || paywall == null) {
            workflow
        } else {
            workflow.withV1Config(paywall) { role ->
                val sku = paywall.popularPlanSku
                when {
                    sku.isNullOrBlank() -> false
                    // The correct mapping, once a tenant has offerings: the role
                    // fronts a product, and that product has the sku.
                    config.productForRole(role)?.sku == sku -> true
                    // Legacy shape. `popularPlanSku` predates roles entirely, and a
                    // v1 tenant has no offerings to map through — so the feature
                    // would be lost for exactly the tenants it was built for. v1
                    // SKUs are period-named ("monthly", "premium_annual"), and the
                    // canonical roles are `${'$'}rc_monthly` / `${'$'}rc_annual`,
                    // so match on that suffix rather than dropping the setting.
                    else -> role.removePrefix("${'$'}rc_")
                        .takeIf { it.isNotBlank() }
                        ?.let { sku.endsWith(it, ignoreCase = true) } == true
                }
            }
        }
    }
    PaywallTreeContent(
        workflow = effective,
        context = context,
        priceFor = priceFor,
        onSelectPackage = onSelectPackage,
        onPurchase = onPurchase,
        onRestore = onRestore,
    )
}
