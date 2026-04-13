package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags

@Composable
fun PlanSelector(
    plans: List<BillingPlan>,
    selectedPlan: BillingPlan?,
    onPlanSelected: (BillingPlan) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .wrapContentHeight()
            .horizontalScroll(rememberScrollState())
            .testTag(PayCraftTestTags.PLAN_SELECTOR_ROW),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.Top,
    ) {
        plans.forEach { plan ->
            PlanCard(
                plan = plan,
                isSelected = selectedPlan?.id == plan.id,
                onSelect = onPlanSelected,
            )
        }
    }
}
