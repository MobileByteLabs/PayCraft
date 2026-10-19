package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import org.koin.compose.koinInject
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
    val isPremium by rememberIsPremium()
    val premiumOnEntry = remember { isPremium }
    LaunchedEffect(isPremium) { if (isPremium && !premiumOnEntry) onSubscribed() }

    // Removed: v1 hand-built content branch(state = …, onDismiss = …, …) hand-built branch.
    // Single paywall path — PayCraftPaywallComposable resolves BrandedStackTemplate.
    PayCraftPaywallComposable(
        onDismiss = onDismiss,
        displayMode = displayMode,
        modifier = modifier,
    )
}

/**
 * Entitlement for the auto-dismiss above, resolved the same way every other SDK surface does.
 *
 * A separate function so the Koin lookup is in one place and `PayCraftPaywall` reads as the
 * behaviour rather than the plumbing.
 */
@Composable
private fun rememberIsPremium() = koinInject<PayCraftRepository>().isPremium.collectAsState()

/**
 * Bottom-sheet variant of the paywall. Preserves the retired v1 behaviour:
 * `dragHandle = null` (no drag chrome) and [PayCraftPaywallAction.RefreshStatus]
 * on the sheet's `onDismissRequest` so a subscription state stale at open time
 * gets re-checked when the user closes without purchasing.
 *
 * Internally delegates to [PayCraftPaywallComposable] — the single paywall path —
 * so the sheet renders through the same v2 template pipeline as [PayCraftPaywall].
 *
 * The sheet declares [PayCraftSurfaceMode.Sheet], which tells the paywall and every template
 * beneath it that THIS composable owns bounds, shape, background and scrim. Without it the
 * paywall's own `fillMaxSize()` + opaque surface expanded the sheet to the full window and
 * painted over the scrim, so the host app behind the sheet went blank.
 *
 * Brand chrome (container colour, corner radius) is applied here rather than inherited from the
 * host app's `MaterialTheme`, matching [PayCraftRestore] and [PayCraftCheckoutSuccessSheet] so all
 * three SDK sheets look like one product.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallSheet(onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    // Resolved here rather than taken as a parameter: the sheet needs the SDK's own MVI engine to
    // dispatch RefreshStatus on close, and a consumer-supplied one would be reimplementing the
    // paywall rather than configuring it. Koin scopes this to the same instance the nested
    // PayCraftPaywallComposable resolves, so dispatching here still reaches the rendered state.
    val viewModel: PayCraftPaywallViewModel = koinViewModel()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Material3 hosts sheet content in a separate window layer that does NOT inherit the
    // PayCraftThemeProvider wrapping the host, so the brand theme is re-applied at the sheet
    // boundary to resolve container colour + radius. Mirrors PayCraftRestore.
    val liveConfig = PayCraft.suiteConfigFlow.collectAsState().value
    PayCraftThemeProvider(config = liveConfig) {
        ModalBottomSheet(
            onDismissRequest = {
                // Preserved from v1: force a status refresh on close so a stale subscription
                // state (e.g. purchase completed in the browser tab) is re-fetched before
                // the host observes billingState next.
                viewModel.dispatch(PayCraftPaywallAction.RefreshStatus)
                onDismiss()
            },
            sheetState = sheetState,
            dragHandle = null,
            containerColor = PayCraftTheme.colors.surface,
            shape = RoundedCornerShape(topStart = SHEET_CORNER_RADIUS, topEnd = SHEET_CORNER_RADIUS),
            modifier = modifier.testTag(PayCraftTestTags.PAYWALL_SHEET),
        ) {
            PayCraftPaywallComposable(
                onDismiss = onDismiss,
                displayMode = DisplayMode.FullScreen,
                surfaceMode = PayCraftSurfaceMode.Sheet,
            )
        }
    }
}

/** Shared top-corner radius for every PayCraft sheet (paywall, restore, checkout success). */
private val SHEET_CORNER_RADIUS = 28.dp
