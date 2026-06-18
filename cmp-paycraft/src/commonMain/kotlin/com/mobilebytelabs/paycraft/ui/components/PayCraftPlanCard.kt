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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_active_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_most_popular_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_per_interval
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_active_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_disabled_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_selected_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_plan_trial_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_chip
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource

private val CardShape = RoundedCornerShape(16.dp)

/**
 * Plan selector card. Matches the dashboard's Paywall designer:
 *
 *   ┌─────────────────────────────────┐
 *   │  Pro Quarterly        $28.47    │   (purple border when selected)
 *   │  Billed every quarter           │
 *   └─────────────────────────────────┘
 *           ─── MOST POPULAR ───            (pill above the card)
 *
 * The "MOST POPULAR" pill overlaps the card's top edge (center-top alignment)
 * instead of sitting in the corner — matches the designer reference and is
 * less crowded than the legacy top-end badge.
 */
@Composable
fun PayCraftPlanCard(
    plan: BillingPlan,
    isSelected: Boolean,
    isActive: Boolean,
    isDisabled: Boolean,
    onSelect: (BillingPlan) -> Unit,
    modifier: Modifier = Modifier,
    /**
     * Whether to show this plan's trial affordance ("N-day free trial" chip).
     * Default true preserves call-site compatibility, but the paywall passes
     * the server-derived isTrialEligible result so users who have already
     * trialed don't see the offer again (TR-006).
     */
    eligibleForTrial: Boolean = true,
) {
    val showTrialChip = plan.trialDays != null && eligibleForTrial && !isActive && !isDisabled
    val isHighlighted = isActive || (isSelected && !isDisabled)

    val borderColor by animateColorAsState(
        targetValue = if (isHighlighted) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.outlineVariant
        },
        animationSpec = tween(durationMillis = 200),
        label = "plan_card_border",
    )

    val contentAlpha = if (isDisabled) 0.45f else 1f

    val cd = when {
        isActive -> stringResource(Res.string.paycraft_plan_active_description, plan.name)
        isDisabled -> stringResource(Res.string.paycraft_plan_disabled_description, plan.name)
        showTrialChip -> stringResource(
            Res.string.paycraft_plan_trial_description,
            plan.name,
            plan.trialDays,
            plan.price,
            plan.interval,
        )
        isSelected -> stringResource(
            Res.string.paycraft_plan_selected_description,
            plan.name,
            plan.price,
            plan.interval,
        )
        else -> stringResource(Res.string.paycraft_plan_description, plan.name, plan.price, plan.interval)
    }

    Box(modifier = modifier.alpha(contentAlpha).padding(top = if (plan.isPopular || isActive) 10.dp else 0.dp)) {
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
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
            border = BorderStroke(
                width = if (isHighlighted) 2.dp else 1.dp,
                color = borderColor,
            ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = plan.name,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_NAME),
                    )
                    Spacer(Modifier.size(2.dp))
                    Text(
                        text = stringResource(Res.string.paycraft_per_interval, plan.interval),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_INTERVAL),
                    )
                    if (showTrialChip) {
                        Spacer(Modifier.size(4.dp))
                        Text(
                            text = stringResource(Res.string.paycraft_trial_chip, plan.trialDays),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_TRIAL_CHIP),
                        )
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    if (plan.hasActiveDiscount) {
                        Text(
                            text = plan.originalPrice!!,
                            style = MaterialTheme.typography.labelMedium,
                            textDecoration = TextDecoration.LineThrough,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        text = plan.price,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (plan.hasActiveDiscount) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        modifier = Modifier.testTag(PayCraftTestTags.PLAN_CARD_PRICE),
                    )
                    if (plan.hasActiveDiscount && plan.discountPercent != null) {
                        Spacer(Modifier.size(2.dp))
                        Badge(
                            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                        ) {
                            Text(
                                text = "${plan.discountPercent}% OFF",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 4.dp),
                            )
                        }
                    }
                }
            }
        }

        // ACTIVE pill — center-top, overlapping the card's top edge.
        if (isActive) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .testTag(PayCraftTestTags.PLAN_CARD_POPULAR_BADGE + "_active"),
            ) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Text(
                        text = stringResource(Res.string.paycraft_active_badge),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp),
                    )
                }
            }
        } else if (plan.isPopular && !isDisabled) {
            // MOST POPULAR pill — center-top, overlapping the card's top edge.
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .testTag(PayCraftTestTags.PLAN_CARD_POPULAR_BADGE),
            ) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Text(
                        text = stringResource(Res.string.paycraft_most_popular_badge),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp),
                    )
                }
            }
        }
    }
}
