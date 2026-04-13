package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags

@Composable
fun PremiumStatusCard(
    status: SubscriptionStatus,
    onManageSubscription: () -> Unit,
    onLogOut: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.PREMIUM_STATUS_CARD),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = "Premium active",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp),
                    )
                    Text(
                        text = "Premium Active",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
                IconButton(
                    onClick = onRefresh,
                    modifier = Modifier
                        .size(48.dp)
                        .testTag(PayCraftTestTags.REFRESH_BUTTON)
                        .semantics { contentDescription = "Refresh subscription status" },
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            HorizontalDivider(
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
            )

            if (status.plan != null) {
                StatusRow(
                    label = "Plan",
                    value = status.plan,
                    testTag = PayCraftTestTags.PREMIUM_PLAN_LABEL,
                )
            }

            if (status.email != null) {
                StatusRow(
                    label = "Account",
                    value = status.email,
                    testTag = PayCraftTestTags.PREMIUM_EMAIL_LABEL,
                )
            }

            if (status.provider != null) {
                StatusRow(
                    label = "Provider",
                    value = status.provider,
                    testTag = PayCraftTestTags.PREMIUM_PROVIDER_LABEL,
                )
            }

            if (status.expiresAt != null) {
                StatusRow(
                    label = "Renews",
                    value = status.expiresAt,
                    testTag = PayCraftTestTags.PREMIUM_EXPIRY_LABEL,
                )
            }

            StatusRow(
                label = "Auto-renew",
                value = if (status.willRenew) "On" else "Off",
                testTag = PayCraftTestTags.PREMIUM_RENEWAL_LABEL,
            )

            Spacer(modifier = Modifier.height(4.dp))

            Button(
                onClick = onManageSubscription,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON)
                    .semantics { contentDescription = "Manage subscription" },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                ),
            ) {
                Text("Manage Subscription")
            }

            OutlinedButton(
                onClick = onLogOut,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag(PayCraftTestTags.LOGOUT_BUTTON)
                    .semantics { contentDescription = "Log out of premium account" },
            ) {
                Text("Log Out")
            }
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String, testTag: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.testTag(testTag),
        )
    }
}
