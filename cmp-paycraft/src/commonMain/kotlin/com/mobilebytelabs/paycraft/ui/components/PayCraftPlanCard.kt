package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_active_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_per_interval
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_active_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_disabled_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_selected_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_popular_badge
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource

private val CardShape = RoundedCornerShape(16.dp)

@Composable
fun PayCraftPlanCard(
    plan: BillingPlan,
    isSelected: Boolean,
    isActive: Boolean,
    isDisabled: Boolean,
    onSelect: (BillingPlan) -> Unit,
    modifier: Modifier = Modifier,
) {
    val borderColor by animateColorAsState(
        targetValue = when {
            isActive -> MaterialTheme.colorScheme.primary
            isSelected && !isDisabled -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.outlineVariant
        },
        animationSpec = tween(durationMillis = 200),
        label = "plan_card_border",
    )

    val containerColor by animateColorAsState(
        targetValue = when {
            isActive || (isSelected && !isDisabled) -> MaterialTheme.colorScheme.primaryContainer
            else -> MaterialTheme.colorScheme.surface
        },
        animationSpec = tween(durationMillis = 200),
        label = "plan_card_background",
    )

    val contentAlpha = if (isDisabled) 0.45f else 1f

    val cd = when {
        isActive -> stringResource(Res.string.paycraft_plan_active_description, plan.name)
        isDisabled -> stringResource(Res.string.paycraft_plan_disabled_description, plan.name)
        isSelected -> stringResource(
            Res.string.paycraft_plan_selected_description,
            plan.name,
            plan.price,
            plan.interval,
        )
        else -> stringResource(Res.string.paycraft_plan_description, plan.name, plan.price, plan.interval)
    }

    Box(modifier = modifier.alpha(contentAlpha)) {
        Card(
            onClick = { if (!isDisabled) onSelect(plan) },
            enabled = !isDisabled,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(PayCraftTestTags.PLAN_CARD_PREFIX + plan.id)
                .semantics {
                    contentDescription = cd
                    role = Role.RadioButton
                },
            shape = CardShape,
            colors = CardDefaults.cardColors(containerColor = containerColor),
            border = BorderStroke(
                width = if (isActive || (isSelected && !isDisabled)) 2.dp else 1.dp,
                color = borderColor,
            ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Radio indicator
                Icon(
                    imageVector = if (isSelected || isActive) {
                        Icons.Filled.RadioButtonChecked
                    } else {
                        Icons.Filled.RadioButtonUnchecked
                    },
                    contentDescription = null,
                    tint = if (isSelected || isActive) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = plan.name,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isSelected || isActive) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_NAME),
                    )
                    Text(
                        text = stringResource(Res.string.paycraft_per_interval, plan.interval),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isSelected || isActive) {
                            MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_INTERVAL),
                    )
                }
                Text(
                    text = plan.price,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (isSelected || isActive) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_PRICE),
                )
            }
        }

        // ACTIVE badge — top priority
        if (isActive) {
            Badge(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .testTag(PayCraftTestTags.PLAN_CARD_POPULAR_BADGE + "_active"),
            ) {
                Text(
                    text = stringResource(Res.string.paycraft_active_badge),
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        } else if (plan.isPopular && !isDisabled) {
            // POPULAR badge — only show when not disabled
            Badge(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .testTag(PayCraftTestTags.PLAN_CARD_POPULAR_BADGE),
            ) {
                Text(
                    text = stringResource(Res.string.paycraft_popular_badge),
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}
