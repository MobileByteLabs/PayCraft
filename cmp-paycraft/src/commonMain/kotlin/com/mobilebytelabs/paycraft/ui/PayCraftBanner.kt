package com.mobilebytelabs.paycraft.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.ui.components.ActiveBadge
import org.koin.compose.koinInject

private const val TAG_BANNER_FREE = "paycraft_banner_free"
private const val TAG_BANNER_PREMIUM = "paycraft_banner_premium"
private const val TAG_BANNER_UPGRADE_BTN = "paycraft_banner_upgrade_button"
private const val TAG_BANNER_MANAGE_BTN = "paycraft_banner_manage_button"
private const val TAG_BANNER_RESTORE_BTN = "paycraft_banner_restore_button"

/**
 * Adaptive settings banner that shows either an upgrade CTA (free user) or a
 * premium status summary (premium user).
 *
 * Observes [BillingManager.billingState] and automatically switches between
 * the two states — no manual state management required.
 *
 * ### Typical usage in a Settings screen
 * ```kotlin
 * var showPaywall by remember { mutableStateOf(false) }
 * var showRestore by remember { mutableStateOf(false) }
 *
 * PayCraftBanner(
 *     onUpgradeClick = { showPaywall = true },
 *     onManageClick = { showPaywall = true },
 *     onRestoreClick = { showRestore = true },
 * )
 *
 * if (showPaywall) PayCraftPaywall(onDismiss = { showPaywall = false })
 * if (showRestore) PayCraftRestore(visible = showRestore, onDismiss = { showRestore = false })
 * ```
 *
 * @param onUpgradeClick Invoked when a free user taps the banner or "Upgrade" button.
 * @param onManageClick Invoked when a premium user taps "Manage" (opens provider portal).
 * @param onRestoreClick Invoked when a free user taps "Restore purchases".
 * @param billingManager Override for testing; resolved from Koin by default.
 */
@Composable
fun PayCraftBanner(
    onUpgradeClick: () -> Unit,
    onManageClick: () -> Unit,
    modifier: Modifier = Modifier,
    onRestoreClick: (() -> Unit)? = null,
    billingManager: BillingManager = koinInject(),
) {
    val billingState by billingManager.billingState.collectAsStateWithLifecycle()

    when (val state = billingState) {
        is BillingState.Premium -> PremiumBanner(
            status = state.status,
            onManageClick = onManageClick,
            modifier = modifier,
        )

        is BillingState.Free, is BillingState.Error, is BillingState.Loading -> FreeBanner(
            onUpgradeClick = onUpgradeClick,
            onRestoreClick = onRestoreClick,
            modifier = modifier,
        )
    }
}

// ------------------------------------------------------------------
// Free user banner
// ------------------------------------------------------------------

@Composable
private fun FreeBanner(onUpgradeClick: () -> Unit, onRestoreClick: (() -> Unit)?, modifier: Modifier = Modifier) {
    val containerColor by animateColorAsState(
        targetValue = MaterialTheme.colorScheme.primaryContainer,
        animationSpec = tween(300),
        label = "banner_bg",
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(containerColor)
            .clickable(
                onClickLabel = "Upgrade to Premium",
                role = Role.Button,
                onClick = onUpgradeClick,
            )
            .padding(16.dp)
            .testTag(TAG_BANNER_FREE)
            .semantics {
                contentDescription = "Upgrade to Premium — tap to see plans"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            imageVector = Icons.Default.Star,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(32.dp),
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Upgrade to Premium",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "Remove ads · Unlimited downloads · Priority support",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f),
            )

            if (onRestoreClick != null) {
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(
                    onClick = onRestoreClick,
                    modifier = Modifier
                        .height(32.dp)
                        .testTag(TAG_BANNER_RESTORE_BTN)
                        .semantics { contentDescription = "Restore purchases" },
                ) {
                    Text(
                        text = "Restore purchases",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

// ------------------------------------------------------------------
// Premium user banner
// ------------------------------------------------------------------

@Composable
private fun PremiumBanner(status: SubscriptionStatus, onManageClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .padding(16.dp)
            .testTag(TAG_BANNER_PREMIUM)
            .semantics {
                val planText = status.plan?.let { " ($it)" } ?: ""
                contentDescription = "Premium active$planText"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            imageVector = Icons.Default.CheckCircle,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(32.dp),
        )

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "Premium",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                ActiveBadge()
            }

            if (status.plan != null) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = status.plan.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f),
                )
            }

            if (status.expiresAt != null) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "Renews ${status.expiresAt}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f),
                )
            }
        }

        Spacer(modifier = Modifier.width(4.dp))

        TextButton(
            onClick = onManageClick,
            modifier = Modifier
                .testTag(TAG_BANNER_MANAGE_BTN)
                .semantics { contentDescription = "Manage your premium subscription" },
        ) {
            Text(
                text = "Manage",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}
