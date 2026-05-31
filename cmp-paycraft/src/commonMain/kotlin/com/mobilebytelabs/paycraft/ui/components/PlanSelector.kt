package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags

@Composable
fun PlanSelector(
    plans: List<BillingPlan>,
    selectedPlan: BillingPlan?,
    currentPlanRank: Int,
    onPlanSelected: (BillingPlan) -> Unit,
    isPremium: Boolean,
    modifier: Modifier = Modifier,
    /**
     * Server-derived trial eligibility from `PayCraftService.isTrialEligible`.
     * Default true keeps existing call-sites compatible; the paywall passes the
     * fetched value so users who have already trialed don't see the offer (TR-006).
     */
    isTrialEligible: Boolean = true,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.PLAN_SELECTOR_ROW),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        plans.forEach { plan ->
            val isActive = isPremium && plan.rank == currentPlanRank
            val isDisabled = isPremium && plan.rank < currentPlanRank
            PayCraftPlanCard(
                plan = plan,
                isSelected = selectedPlan?.id == plan.id,
                isActive = isActive,
                isDisabled = isDisabled,
                onSelect = onPlanSelected,
                eligibleForTrial = isTrialEligible,
            )
        }
    }
}
