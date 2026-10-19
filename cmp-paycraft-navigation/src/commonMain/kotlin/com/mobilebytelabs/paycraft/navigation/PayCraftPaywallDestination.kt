/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.mobilebytelabs.paycraft.ui.DisplayMode
import com.mobilebytelabs.paycraft.ui.PayCraftPaywall
import kotlinx.serialization.Serializable

/**
 * The paywall's route key.
 *
 * `@Serializable` because Navigation Compose keys type-safe destinations by type. A host never
 * constructs this — it navigates with [navigateToPayCraftPaywall] and registers the destination
 * with [payCraftPaywallDestination].
 */
@Serializable
data object PayCraftPaywallRoute

/** Navigate to the SDK paywall. */
fun NavController.navigateToPayCraftPaywall(navOptions: NavOptions? = null) = navigate(PayCraftPaywallRoute, navOptions)

/**
 * Register the paywall as a destination in the host's navigation graph.
 *
 * ```kotlin
 * NavHost(navController, startDestination = Home) {
 *     payCraftPaywallDestination(
 *         onDismiss = navController::popBackStack,
 *         onSubscribed = { navController.navigateToHome() },   // resume the flow after purchase
 *     )
 * }
 * ```
 *
 * ## When to use this rather than a gate
 *
 * Use a gate or a banner when the paywall is a REACTION — locked content tapped, an upsell CTA.
 * Those present the paywall themselves and need no route at all. Use this when the paywall is a
 * STEP in a flow the host owns; the canonical case is onboarding's "start free trial", where
 * nothing is gated and the user is moving forward through a sequence.
 *
 * ## What it saves a consumer writing
 *
 * The route key, the `NavController` extension, and the destination registration. Before
 * cmp-paycraft 2.4.6 it also saved a purchase watcher with a guard that is easy to get subtly
 * wrong; that now lives inside [PayCraftPaywall] itself as `onSubscribed`, which is why this
 * function can be a thin binding rather than a place logic accumulates.
 *
 * If a host's own destination grows an `isPremium` collector or a tier check, that belongs in the
 * SDK — it is billing logic wearing a navigation hat.
 *
 * @param onDismiss the user closed the paywall without buying. Usually `navController::popBackStack`.
 * @param onSubscribed entitlement became premium WHILE the paywall was open. Defaults to
 *   [onDismiss], which pops back — right for a settings-initiated visit. Pass a continuation to
 *   resume a flow instead, which is what onboarding wants. The SDK guards this so a subscriber who
 *   opens the paywall merely to browse plans is not immediately ejected.
 * @param displayMode [DisplayMode.FullScreen] for a destination; `Banner` only makes sense inline.
 * @param enterTransition / @param exitTransition / @param popEnterTransition /
 *   @param popExitTransition the host's own animations; null uses the NavHost default.
 *
 *   ALL FOUR, not just enter/exit. An app with a push-transition system drives every slot — the
 *   screen slides in, the one behind it holds, and both reverse on pop. Exposing only two would
 *   make this destination unusable by precisely the apps that have a transition system, which are
 *   the ones that hand-roll a destination to get them. Measured on `mbs/cappy`, whose
 *   `composableWithPushTransitions` sets all four.
 *
 *   Transitions are parameters rather than a fixed choice because they are an app's visual
 *   identity; a library picking them is why hosts hand-roll destinations in the first place.
 */
fun NavGraphBuilder.payCraftPaywallDestination(
    onDismiss: () -> Unit,
    onSubscribed: () -> Unit = onDismiss,
    displayMode: DisplayMode = DisplayMode.FullScreen,
    enterTransition: (AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition?)? = null,
    exitTransition: (AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition?)? = null,
    popEnterTransition: (AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition?)? = enterTransition,
    popExitTransition: (AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition?)? = exitTransition,
) {
    composable<PayCraftPaywallRoute>(
        enterTransition = enterTransition,
        exitTransition = exitTransition,
        popEnterTransition = popEnterTransition,
        popExitTransition = popExitTransition,
    ) {
        PayCraftPaywall(
            onDismiss = onDismiss,
            displayMode = displayMode,
            onSubscribed = onSubscribed,
        )
    }
}
