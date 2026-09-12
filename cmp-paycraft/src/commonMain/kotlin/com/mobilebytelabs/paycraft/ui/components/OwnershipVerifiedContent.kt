/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * OwnershipVerified confirmation (AC-25).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_cancel
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_confirm
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_title

/**
 * Explicit confirmation before a device transfer.
 *
 * Required rather than cosmetic: confirming DEACTIVATES the other device, so a user who verified
 * ownership to check something would otherwise sign themselves out of a working device by
 * accident. `BillingState.OwnershipVerified`'s own doc says the UI MUST confirm before calling
 * `confirmDeviceTransfer()`; this is that gate.
 *
 * Dismissal is treated as cancel, so an accidental tap outside never transfers.
 */
/**
 * The dialog's CONTENT, extracted so it can be rendered and asserted on directly.
 *
 * `AlertDialog` composes into a separate popup layer that the desktop test tree does not reach, so
 * a golden of the dialog captures the host behind it and `onNodeWithTag` finds nothing. Splitting
 * the content out is not a test workaround — it makes the surface independently renderable, which
 * is what lets AC-28 pair a golden with a real assertion instead of pinning an empty frame.
 *
 * The dialog below is now a thin wrapper over this.
 */
@Composable
fun OwnershipVerifiedContent(
    state: BillingState.OwnershipVerified,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val deviceName = state.conflictingDeviceName ?: "the other device"
    Column(
        modifier = modifier.padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_ownership_verified_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = stringResource(Res.string.paycraft_ownership_verified_body, deviceName),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(
                onClick = { onAction(PayCraftPaywallAction.CancelDeviceTransfer) },
                modifier = Modifier.testTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CANCEL),
            ) { Text(stringResource(Res.string.paycraft_ownership_verified_cancel)) }
            TextButton(
                onClick = { onAction(PayCraftPaywallAction.ConfirmDeviceTransfer) },
                modifier = Modifier.testTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CONFIRM),
            ) { Text(stringResource(Res.string.paycraft_ownership_verified_confirm)) }
        }
    }
}
