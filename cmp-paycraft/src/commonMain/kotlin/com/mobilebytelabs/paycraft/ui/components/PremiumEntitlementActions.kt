/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The two entitlement operations a paying customer needs (AC-27).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_manage
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_restore

/**
 * Restore + Manage, on the premium arm.
 *
 * The premium screen previously rendered a check icon, "You're Premium", and the plan name — and
 * nothing else. A subscriber who reinstalled had no way to restore, and one who wanted to cancel
 * had no way to reach the store's management page, even though `BillingManager` exposed both
 * operations and the ViewModel already handled the corresponding actions. Two buttons that route
 * to existing behaviour, not new machinery.
 *
 * Reuses the existing MANAGE_SUBSCRIPTION_BUTTON tag rather than declaring a second one.
 */
@Composable
fun PremiumEntitlementActions(
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = { onAction(PayCraftPaywallAction.OpenRestoreSheet) },
            modifier = Modifier.weight(1f).testTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON),
        ) { Text(stringResource(Res.string.paycraft_premium_restore)) }

        TextButton(
            onClick = { onAction(PayCraftPaywallAction.ManageSubscription) },
            modifier = Modifier.weight(1f).testTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON),
        ) { Text(stringResource(Res.string.paycraft_premium_manage)) }
    }
}
