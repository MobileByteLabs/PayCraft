package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags

@Composable
fun PlanCard(plan: BillingPlan, isSelected: Boolean, onSelect: (BillingPlan) -> Unit, modifier: Modifier = Modifier) {
    val borderColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.outlineVariant
        },
        animationSpec = tween(durationMillis = 200),
        label = "plan_card_border",
    )

    val containerColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        animationSpec = tween(durationMillis = 200),
        label = "plan_card_background",
    )

    Box(modifier = modifier) {
        Card(
            onClick = { onSelect(plan) },
            modifier = Modifier
                .widthIn(min = 100.dp)
                .testTag(PayCraftTestTags.PLAN_CARD_PREFIX + plan.id)
                .semantics {
                    contentDescription =
                        "${plan.name} plan, ${plan.price} per ${plan.interval}${if (isSelected) ", selected" else ""}"
                    role = Role.RadioButton
                },
            colors = CardDefaults.cardColors(containerColor = containerColor),
            border = BorderStroke(
                width = if (isSelected) 2.dp else 1.dp,
                color = borderColor,
            ),
            elevation = CardDefaults.cardElevation(
                defaultElevation = if (isSelected) 4.dp else 1.dp,
            ),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = plan.price,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (isSelected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_PRICE),
                )
                Text(
                    text = plan.name,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (isSelected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_NAME),
                )
                Text(
                    text = "per ${plan.interval}",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isSelected) {
                        MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    },
                    modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_INTERVAL),
                )
            }
        }

        if (plan.isPopular) {
            Badge(
                containerColor = MaterialTheme.colorScheme.tertiary,
                contentColor = MaterialTheme.colorScheme.onTertiary,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .testTag(PayCraftTestTags.PLAN_CARD_POPULAR_BADGE),
            ) {
                Text(
                    text = "Popular",
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}
