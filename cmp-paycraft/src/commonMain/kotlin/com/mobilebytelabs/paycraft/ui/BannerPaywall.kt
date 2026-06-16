package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
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
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = contentColor,
                )
                Spacer(Modifier.size(width = 12.dp, height = 0.dp))
            }
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag(PayCraftTestTags.BANNER_LABEL),
            )
            Spacer(Modifier.weight(1f))
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}
