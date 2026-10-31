/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The entitlement operation a paying customer needs (AC-27).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_manage
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource

/**
 * Manage — the premium arm's ONE action.
 *
 * Restore used to sit beside it. It was removed (2026-10-31): once the subscription has been fetched
 * there is nothing to restore, and a Restore button on the "You're Premium" screen reads like "your
 * purchase might be missing". A reinstalled subscriber is restored by launch sync before this screen
 * can render, and a not-yet-restored one sees the FREE arm, which keeps Restore. Mirrors
 * `restoreActionFor` on the settings card.
 *
 * Reuses the existing MANAGE_SUBSCRIPTION_BUTTON tag rather than declaring a second one.
 */
@Composable
fun PremiumEntitlementActions(onAction: (PayCraftPaywallAction) -> Unit, modifier: Modifier = Modifier) {
    PaywallPrimaryButton(
        text = stringResource(Res.string.paycraft_premium_manage),
        onClick = { onAction(PayCraftPaywallAction.ManageSubscription) },
        icon = Icons.Outlined.Settings,
        modifier = modifier
            .padding(horizontal = 24.dp, vertical = 24.dp)
            .testTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON),
    )
}
