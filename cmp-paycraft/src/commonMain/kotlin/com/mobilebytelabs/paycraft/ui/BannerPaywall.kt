package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.components.skeleton.BannerShimmerRow
import org.koin.compose.viewmodel.koinViewModel

/**
 * Compact, state-aware billing strip designed to live on a host screen — typically the
 * top of a home / profile screen — without taking the user out of context.
 *
 * The banner reads the current [BillingState] and renders a short label + tap target.
 * Tapping the banner calls [onTap] so the host can open the full paywall, navigate to
 * a "manage subscription" screen, or trigger a refresh on error.
 *
 * @param state    Current [BillingState] from `PayCraftPaywallViewModel.state.billingState`.
 * @param onTap    Called when the user taps the banner. Hosts usually open the full
 *                 paywall here; on error, the SDK already retries silently in the
 *                 background, so opening the paywall on tap surfaces the latest state.
 * @param modifier Optional [Modifier] applied to the root [Surface].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BannerPaywall(state: BillingState, onTap: () -> Unit, modifier: Modifier = Modifier) {
    val label: String = when (state) {
        is BillingState.Free -> "Upgrade to Premium"
        is BillingState.Premium -> when {
            state.trial != null -> "Free trial — ${state.trial.daysRemaining} days left"
            else -> "Premium active"
        }
        is BillingState.Loading -> "Checking your subscription…"
        is BillingState.Error -> "Couldn't sync — tap to retry"
        // Not an error: the store is still collecting the money. Never invite a second purchase.
        is BillingState.PaymentPending -> "Payment pending — premium unlocks automatically"
        is BillingState.DeviceConflict -> "Verify ownership to continue"
        is BillingState.OwnershipVerified -> "Manage subscription"
    }

    val containerColor: Color = when (state) {
        is BillingState.Premium -> MaterialTheme.colorScheme.primaryContainer
        is BillingState.Error -> MaterialTheme.colorScheme.errorContainer
        else -> MaterialTheme.colorScheme.secondaryContainer
    }

    val contentColor: Color = when (state) {
        is BillingState.Premium -> MaterialTheme.colorScheme.onPrimaryContainer
        is BillingState.Error -> MaterialTheme.colorScheme.onErrorContainer
        else -> MaterialTheme.colorScheme.onSecondaryContainer
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .testTag(PayCraftTestTags.BANNER_PAYWALL)
            .semantics { contentDescription = label },
        color = containerColor,
        contentColor = contentColor,
        onClick = onTap,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state is BillingState.Loading) {
                // Phase 3 (AC-5, AC-14): the banner Loading branch renders a
                // layout-matched shimmer pill instead of a CircularProgressIndicator,
                // so the compact banner keeps the same intrinsic height when
                // swapping between Loading/Free/Premium and never flashes a spinner.
                BannerShimmerRow(
                    modifier = Modifier.weight(1f),
                )
            } else {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .weight(1f)
                        .testTag(PayCraftTestTags.BANNER_LABEL),
                )
            }
            Spacer(Modifier.size(width = 12.dp, height = 0.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

/**
 * Convenience overload — the ViewModel-observing version of [BannerPaywall]
 * that hosts drop into a screen without wiring their own state.
 *
 * Delegates through [PayCraftPaywallComposable] with [DisplayMode.Banner] so the
 * banner shares the single paywall path with [PayCraftPaywall] / [PayCraftPaywallSheet]
 * (Phase-2 clean-SDK consolidation, AC-4). The composable observes
 * [PayCraftPaywallViewModel.state] and re-renders the compact status strip on every
 * [BillingState] transition.
 *
 * @param onTap    Called when the user taps the banner. Hosts usually open the full
 *                 paywall here.
 * @param modifier Optional modifier applied to the root surface.
 * @param viewModel ViewModel — Koin-injected by default.
 */
@Composable
fun BannerPaywall(
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    // Route through the single paywall path so a future template-side banner
    // redesign lands in ONE place instead of forking between v1/v2.
    PayCraftPaywallComposable(
        onDismiss = onTap,
        displayMode = DisplayMode.Banner,
        modifier = modifier,
        viewModel = viewModel,
    )
}

/**
 * Test / debug helper — resolves the compact banner label for [state] without
 * standing up the full Compose runtime. Kept in sync with [BannerPaywall]'s own
 * `when` above so unit tests can assert the state → label contract cheaply.
 *
 * @suppress internal — public visibility is a lint courtesy for the test harness;
 * this is not part of the SDK's advertised surface.
 */
@Suppress("unused")
internal fun bannerPaywallLabelFor(state: BillingState): String = when (state) {
    is BillingState.Free -> "Upgrade to Premium"
    is BillingState.Premium -> when {
        state.trial != null -> "Free trial — ${state.trial.daysRemaining} days left"
        else -> "Premium active"
    }
    is BillingState.Loading -> "Checking your subscription…"
    is BillingState.Error -> "Couldn't sync — tap to retry"
    is BillingState.PaymentPending -> "Payment pending — premium unlocks automatically"
    is BillingState.DeviceConflict -> "Verify ownership to continue"
    is BillingState.OwnershipVerified -> "Manage subscription"
}
