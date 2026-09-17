package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/**
 * WHO owns the paywall's bounds and background — the paywall itself, or the container hosting it.
 *
 * This is the fix for the "paywall goes blank behind the sheet" class of bug (UI-1/UI-2). A paywall
 * rendered inside a [androidx.compose.material3.ModalBottomSheet] sits in a slot that is already
 * sized, shaped, coloured and scrimmed by the sheet. If the paywall ALSO declares `fillMaxSize()`
 * and paints an opaque background, it expands the sheet to the full window and covers the scrim —
 * so the host app behind it disappears and the "sheet" reads as an opaque full-screen takeover.
 *
 * Every layer that could paint a root background ([com.mobilebytelabs.paycraft.presentation.PaywallTemplate]
 * implementations, the paywall scaffold) reads this local and defers to the container when it is
 * [Sheet]. Exactly one layer paints, always.
 */
enum class PayCraftSurfaceMode {
    /**
     * The paywall owns the window: it fills all available space and paints its own opaque
     * background. Used by `PayCraftPaywall` when the host renders it as a screen.
     */
    FullScreen,

    /**
     * A container (bottom sheet / dialog) owns bounds, shape, background and scrim. The paywall
     * fills width, wraps height, and paints NO background so the container's colour and the scrim
     * behind it both remain visible. Used by `PayCraftPaywallSheet`.
     */
    Sheet,
}

/**
 * The surface mode in effect for the current paywall composition. Defaults to
 * [PayCraftSurfaceMode.FullScreen] so a template rendered standalone (previews, screenshot tests,
 * a host embedding a template directly) keeps its historical self-painting behaviour.
 */
val LocalPayCraftSurfaceMode = staticCompositionLocalOf { PayCraftSurfaceMode.FullScreen }

/**
 * Root modifier for any composable that would otherwise declare `fillMaxSize().background(…)`.
 *
 * - [PayCraftSurfaceMode.FullScreen] → `fillMaxSize()` + opaque [background].
 * - [PayCraftSurfaceMode.Sheet]      → `fillMaxWidth()` only; height wraps to content (bounded by
 *   the sheet) and the background is left to the sheet, preserving its scrim.
 */
@Composable
@ReadOnlyComposable
fun Modifier.paywallRoot(background: Color): Modifier = when (LocalPayCraftSurfaceMode.current) {
    PayCraftSurfaceMode.FullScreen -> this.fillMaxSize().background(background)
    PayCraftSurfaceMode.Sheet -> this.fillMaxWidth()
}

/**
 * Sizing-only variant of [paywallRoot] for inner containers that size themselves but do NOT paint
 * (e.g. a scrolling content [androidx.compose.foundation.layout.Column] inside a template).
 *
 * A `fillMaxSize()` scroll column inside a wrap-height sheet would force the sheet to full height
 * just as a painted root does, so it needs the same treatment.
 */
@Composable
@ReadOnlyComposable
fun Modifier.paywallContentSize(): Modifier = when (LocalPayCraftSurfaceMode.current) {
    PayCraftSurfaceMode.FullScreen -> this.fillMaxSize()
    PayCraftSurfaceMode.Sheet -> this.fillMaxWidth()
}
