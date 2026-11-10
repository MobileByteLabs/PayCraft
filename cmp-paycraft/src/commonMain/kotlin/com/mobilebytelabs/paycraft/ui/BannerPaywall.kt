package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_checking
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_manage
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_payment_pending
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_premium_active
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_sync_failed
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_trial_days_left
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_upgrade
import com.mobilebytelabs.paycraft.generated.resources.paycraft_strip_verify_ownership
import com.mobilebytelabs.paycraft.model.BillingState
import org.jetbrains.compose.resources.stringResource

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
        is BillingState.Free -> stringResource(Res.string.paycraft_strip_upgrade)
        is BillingState.Premium -> when (val trial = state.trial) {
            null -> stringResource(Res.string.paycraft_strip_premium_active)
            else -> stringResource(Res.string.paycraft_strip_trial_days_left, trial.daysRemaining)
        }
        is BillingState.Loading -> stringResource(Res.string.paycraft_strip_checking)
        is BillingState.Error -> stringResource(Res.string.paycraft_strip_sync_failed)
        // Not an error: the store is still collecting the money. Never invite a second purchase.
        is BillingState.PaymentPending -> stringResource(Res.string.paycraft_strip_payment_pending)
        is BillingState.DeviceConflict -> stringResource(Res.string.paycraft_strip_verify_ownership)
        is BillingState.OwnershipVerified -> stringResource(Res.string.paycraft_strip_manage)
    }

    // One colour role per state (Stitch sdk-plan-card 10), all from the host MaterialTheme: premium
    // primary, trial tertiary, error error, pending a neutral surface (it is not a problem), and the
    // remaining asks — upgrade / verify / manage — secondary.
    val colors = MaterialTheme.colorScheme
    val (containerColor, contentColor) = when (state) {
        is BillingState.Premium ->
            if (state.trial != null) {
                colors.tertiaryContainer to colors.onTertiaryContainer
            } else {
                colors.primaryContainer to colors.onPrimaryContainer
            }
        is BillingState.Error -> colors.errorContainer to colors.onErrorContainer
        is BillingState.PaymentPending, is BillingState.Loading -> colors.surfaceVariant to colors.onSurfaceVariant
        else -> colors.secondaryContainer to colors.onSecondaryContainer
    }

    val icon: ImageVector? = when (state) {
        is BillingState.Free -> Icons.Filled.WorkspacePremium
        is BillingState.Premium -> if (state.trial != null) Icons.Filled.HourglassTop else Icons.Outlined.Verified
        is BillingState.Loading -> null
        is BillingState.Error -> Icons.Filled.ErrorOutline
        is BillingState.PaymentPending -> Icons.Filled.Sync
        is BillingState.DeviceConflict -> Icons.Filled.Key
        is BillingState.OwnershipVerified -> Icons.Filled.ManageAccounts
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .testTag(PayCraftTestTags.BANNER_PAYWALL)
            .semantics { contentDescription = label },
        color = containerColor,
        contentColor = contentColor,
        onClick = onTap,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Leading tile: the state's glyph, or — while the status is unknown — a small spinner
            // in the same 36dp footprint, so Loading → Free/Premium swaps without a height shift.
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(LocalContentColor.current.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (icon != null) {
                    Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = LocalContentColor.current,
                        trackColor = Color.Transparent,
                    )
                }
            }
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .weight(1f)
                    .testTag(PayCraftTestTags.BANNER_LABEL),
            )
            Icon(
                imageVector = Icons.Filled.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
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
 */
@Composable
fun BannerPaywall(onTap: () -> Unit, modifier: Modifier = Modifier) {
    // Route through the single paywall path so a future template-side banner
    // redesign lands in ONE place instead of forking between v1/v2. No ViewModel is threaded
    // through: PayCraftPaywallComposable resolves the SDK's own, which is why that parameter is
    // gone from here too — a consumer substituting the MVI engine would be reimplementing the
    // paywall rather than configuring it.
    PayCraftPaywallComposable(
        onDismiss = onTap,
        displayMode = DisplayMode.Banner,
        modifier = modifier,
    )
}
