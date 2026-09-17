package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The three footer affordances every paywall template renders — Privacy, Terms, Restore.
 *
 * Templates are pure presentation: [com.mobilebytelabs.paycraft.presentation.PaywallTemplate.render]
 * receives products and a pick callback, but no route to the SDK's action pipeline. Before this
 * existed, the default template's footer links were wired to empty lambdas with a `/* host opens
 * via custom intent */` note — so PRIVACY, TERMS and RESTORE rendered as tappable text that did
 * nothing on every paywall the SDK shipped (a dead-clickable, RULE-IMPL-DEAD-CLICKABLE-001).
 *
 * The hosting surface provides real implementations; the default here keeps standalone template
 * previews and screenshot tests renderable without an SDK runtime.
 *
 * @param onOpenPrivacy opens `PaywallDto.privacyUrl`. Only invoked when that URL is non-blank.
 * @param onOpenTerms   opens `PaywallDto.termsUrl`. Only invoked when that URL is non-blank.
 * @param onRestore     dispatches [PayCraftPaywallAction.OpenRestoreSheet].
 */
data class PayCraftPaywallFooterActions(
    val onOpenPrivacy: () -> Unit = {},
    val onOpenTerms: () -> Unit = {},
    val onRestore: () -> Unit = {},
)

/**
 * Footer actions in effect for the current paywall composition. Provided by
 * `PayCraftPaywallComposable`; defaults to no-ops so a template rendered outside the SDK (preview,
 * screenshot test) still composes.
 */
val LocalPayCraftPaywallFooterActions = staticCompositionLocalOf { PayCraftPaywallFooterActions() }
