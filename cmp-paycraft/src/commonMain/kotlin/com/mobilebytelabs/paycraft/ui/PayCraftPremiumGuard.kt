package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import org.koin.compose.koinInject

/**
 * Guards [content] behind a premium check.
 *
 * - If the user is premium: renders [content] directly.
 * - If not premium / loading: shows a lock screen with [onUpgrade] CTA.
 *
 * Usage:
 * ```kotlin
 * PayCraftPremiumGuard(onUpgrade = { showPaywall = true }) {
 *     PremiumFeatureContent()
 * }
 * ```
 */
@Composable
fun PayCraftPremiumGuard(
    onUpgrade: () -> Unit,
    modifier: Modifier = Modifier,
    lockTitle: String = "Premium Feature",
    lockDescription: String = "Upgrade to unlock this feature and much more.",
    upgradeButtonLabel: String = "Upgrade to Premium",
    billingManager: BillingManager = koinInject(),
    content: @Composable () -> Unit,
) {
    val billingState by billingManager.billingState.collectAsStateWithLifecycle()

    when (billingState) {
        is BillingState.Premium -> {
            Box(
                modifier = modifier.testTag(PayCraftTestTags.PREMIUM_GUARD_UNLOCKED),
            ) {
                content()
            }
        }

        else -> {
            PremiumLockedContent(
                title = lockTitle,
                description = lockDescription,
                upgradeButtonLabel = upgradeButtonLabel,
                onUpgrade = onUpgrade,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun PremiumLockedContent(
    title: String,
    description: String,
    upgradeButtonLabel: String,
    onUpgrade: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .testTag(PayCraftTestTags.PREMIUM_GUARD_LOCKED),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = "Premium feature locked",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(64.dp),
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onUpgrade,
                modifier = Modifier
                    .height(52.dp)
                    .widthIn(min = 200.dp)
                    .testTag(PayCraftTestTags.PREMIUM_GUARD_UPGRADE_BUTTON)
                    .semantics { contentDescription = upgradeButtonLabel },
            ) {
                Text(upgradeButtonLabel)
            }
        }
    }
}
