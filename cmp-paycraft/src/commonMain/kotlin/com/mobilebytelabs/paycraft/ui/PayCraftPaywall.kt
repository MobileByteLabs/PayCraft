package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import org.koin.compose.viewmodel.koinViewModel

/**
 * PayCraft paywall — the SINGLE public entry point for the SDK's paywall UI
 * (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Renders either a [DisplayMode.FullScreen] paywall (default) or a compact
 * [DisplayMode.Banner] status strip — both observe the same [PayCraftPaywallViewModel]
 * and react to the same `BillingState`. Hosts pick the shape that fits the surface
 * they're rendering on.
 *
 * Every render path lives inside [PayCraftPaywallComposable] — the v2 cloud-template
 * pipeline that resolves [com.mobilebytelabs.paycraft.presentation.PaywallTemplate]
 * (BrandedStackTemplate by default) and renders every
 * [com.mobilebytelabs.paycraft.model.BillingState] branch. The retired v1
 * `v1 hand-built content branch` hand-built `when`-over-`BillingState` is DELETED — its
 * behaviour is fully absorbed into [PayCraftPaywallComposable] plus the
 * `BrandedStackTemplate`'s `DeviceConflict` / `OwnershipVerified` branches so no
 * user-visible state is dropped.
 *
 * Phase 3 (AC-5, AC-14): every `BillingState.Loading` branch in the single paywall
 * path now renders a layout-matched
 * [com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton] instead of
 * a centered progress indicator — the skeleton mirrors the loaded template layout
 * one-to-one (hero + subtitle + plans grid + CTA), animates through
 * [com.mobilebytelabs.paycraft.ui.components.shimmer.Modifier.shimmerWave], and
 * degrades to a static background under OS reduce-motion. The Content branch
 * delegates to [ProductList] for its plans surface (AC-7). Warm-cache paywalls
 * skip the skeleton entirely because [com.mobilebytelabs.paycraft.PayCraft.initialize]
 * prefetches products fire-and-forget (AC-8).
 *
 * Banner-mode callers should treat [onDismiss] as "user tapped the banner" — typically
 * a signal to show the full-screen paywall in a sheet or dialog.
 *
 * @param onDismiss   Invoked when the paywall dismisses (close button, viewmodel event,
 *                    banner tap). Hosts wire this to close their sheet/dialog wrapper.
 * @param modifier    Optional modifier applied to the root surface.
 * @param displayMode [DisplayMode.FullScreen] (default) or [DisplayMode.Banner].
 */
@Composable
fun PayCraftPaywall(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    displayMode: DisplayMode = DisplayMode.FullScreen,
    onSubscribed: () -> Unit = onDismiss,
) {
    // "They bought it — leave" is the SDK's to know, not the host's.
    //
    // Every consumer placing the paywall as a destination had to write this themselves, and it is
    // subtle in a way that is easy to get wrong: `premiumOnEntry` separates "just purchased" from
    // "arrived already subscribed". Without it, a subscriber who opens the paywall to look at
    // plans is immediately thrown out of it. Measured on `mbs/cappy`, this exact LaunchedEffect
    // lived in the host's nav destination.
    //
    // Defaulting to [onDismiss] means a host that does not care gets the obvious behaviour; one
    // mid-onboarding passes a different continuation.
    //
    // PostPurchaseLinkGate owns that "just purchased" detection now, and inserts the optional
    // account-link step for a store purchase made without an identity (PLAN-paycraft-native-identity).
    PostPurchaseLinkGate(onFinished = onSubscribed) {
        // Single paywall path — PayCraftPaywallComposable resolves BrandedStackTemplate.
        PayCraftPaywallComposable(
            onDismiss = onDismiss,
            displayMode = displayMode,
            modifier = modifier,
        )
    }
}

/**
 * The paywall presented FULL SCREEN over the host (PLAN-paycraft-native-identity D5). The name is
 * kept from the bottom-sheet era for API compatibility; the sheet cramped plan cards on small phones.
 *
 * Preserves the v1 contract: closing (X, back, outside) dispatches [PayCraftPaywallAction.RefreshStatus]
 * so a subscription state stale at open time is re-checked. After a STORE purchase made without an
 * identity it shows the optional account-link step once ([PostPurchaseLinkGate]) before [onDismiss].
 *
 * Brand chrome is applied here rather than inherited from the host's `MaterialTheme` — a dialog is a
 * separate window that does not see the host's [PayCraftThemeProvider].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallSheet(onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    // Resolved here rather than taken as a parameter: the sheet needs the SDK's own MVI engine to
    // dispatch RefreshStatus on close, and a consumer-supplied one would be reimplementing the
    // paywall rather than configuring it. Koin scopes this to the same instance the nested
    // PayCraftPaywallComposable resolves, so dispatching here still reaches the rendered state.
    val viewModel: PayCraftPaywallViewModel = koinViewModel()
    val close = {
        // Preserved from v1: force a status refresh on close so a stale subscription state (e.g.
        // purchase completed in the browser tab) is re-fetched before the host observes billingState.
        viewModel.dispatch(PayCraftPaywallAction.RefreshStatus)
        onDismiss()
    }

    // Material3 hosts sheet content in a separate window layer that does NOT inherit the
    // PayCraftThemeProvider wrapping the host, so the brand theme is re-applied at the sheet
    // boundary to resolve container colour + radius. Mirrors PayCraftRestore.
    val liveConfig = PayCraft.suiteConfigFlow.collectAsState().value
    PayCraftThemeProvider(config = liveConfig) {
        // FULL SCREEN (PLAN-paycraft-native-identity D5). A partial sheet cramped plan cards on small
        // phones; the name stays for API compatibility. The close (X) and back stay immediate.
        Dialog(
            onDismissRequest = close,
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(
                color = PayCraftTheme.colors.surface,
                modifier = modifier.fillMaxSize().testTag(PayCraftTestTags.PAYWALL_SHEET),
            ) {
                PostPurchaseLinkGate(onFinished = onDismiss) {
                    PayCraftPaywallComposable(
                        onDismiss = close,
                        displayMode = DisplayMode.FullScreen,
                        surfaceMode = PayCraftSurfaceMode.FullScreen,
                    )
                }
            }
        }
    }
}

/** Shared top-corner radius for every PayCraft sheet (paywall, restore, checkout success). */
private val SHEET_CORNER_RADIUS = 28.dp
