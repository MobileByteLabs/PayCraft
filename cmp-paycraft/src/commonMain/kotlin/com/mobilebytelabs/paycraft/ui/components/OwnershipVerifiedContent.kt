/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * OwnershipVerified confirmation (AC-25).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_limit_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_limit_remove
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_limit_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_platform_android
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_platform_desktop
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_platform_ios
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_platform_web
import com.mobilebytelabs.paycraft.generated.resources.paycraft_devices_this_device
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_cancel
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_confirm
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_other_device
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ownership_verified_title
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.network.ActiveDevice
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

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
    if (state.activeDevices.isNotEmpty()) {
        DeviceLimitContent(state, onAction, modifier)
        return
    }
    val colors = PayCraftTheme.colors
    val deviceName = state.conflictingDeviceName ?: stringResource(Res.string.paycraft_ownership_verified_other_device)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 16.dp)
            .testTag(PayCraftTestTags.OWNERSHIP_VERIFIED),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IdentityHeroTile(icon = Icons.Outlined.Devices, badge = Icons.Filled.Check, badgeColor = colors.activeBadge)
        Text(
            text = stringResource(Res.string.paycraft_ownership_verified_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(Res.string.paycraft_ownership_verified_body, deviceName),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { onAction(PayCraftPaywallAction.ConfirmDeviceTransfer) },
            modifier = Modifier
                .fillMaxWidth()
                .height(IdentityCtaHeight)
                .testTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CONFIRM),
            shape = IdentityCtaShape,
            colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.onAccent),
        ) {
            Text(
                stringResource(Res.string.paycraft_ownership_verified_confirm),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        TextButton(
            onClick = { onAction(PayCraftPaywallAction.CancelDeviceTransfer) },
            modifier = Modifier.testTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CANCEL),
        ) {
            Text(
                stringResource(Res.string.paycraft_ownership_verified_cancel),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The subscription is at its device limit (server 178+): every device holding a seat is listed and the
 * buyer signs one out to use Pro here — one subscription, any mix of phone, tablet and web, like the
 * streaming services. Nothing is signed out until a device's own "Sign out" is tapped.
 */
@Composable
private fun DeviceLimitContent(
    state: BillingState.OwnershipVerified,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 16.dp)
            .testTag(PayCraftTestTags.OWNERSHIP_VERIFIED),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IdentityHeroTile(icon = Icons.Outlined.Devices, badge = Icons.Filled.Check, badgeColor = colors.activeBadge)
        Text(
            text = stringResource(Res.string.paycraft_device_limit_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(Res.string.paycraft_device_limit_body, state.maxDevices),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        state.activeDevices.forEach { device -> LimitDeviceRow(device, onAction) }
        TextButton(
            onClick = { onAction(PayCraftPaywallAction.CancelDeviceTransfer) },
            modifier = Modifier.testTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CANCEL),
        ) {
            Text(
                stringResource(Res.string.paycraft_ownership_verified_cancel),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun LimitDeviceRow(device: ActiveDevice, onAction: (PayCraftPaywallAction) -> Unit) =
    ActiveDeviceRow(device) { onAction(PayCraftPaywallAction.RemoveDeviceAndTransfer(it)) }

/** One active device: its name, platform (and "This device"), and its own "Sign out" button. */
@Composable
internal fun ActiveDeviceRow(device: ActiveDevice, onSignOut: (String) -> Unit) {
    Surface(
        shape = IdentityCtaShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = device.name ?: platformLabel(device.platform),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = if (device.thisDevice) {
                        stringResource(Res.string.paycraft_devices_this_device, platformLabel(device.platform))
                    } else {
                        platformLabel(device.platform)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedButton(
                onClick = { onSignOut(device.ref) },
                modifier = Modifier.testTag(PayCraftTestTags.deviceRemove(device.ref)),
            ) {
                Text(stringResource(Res.string.paycraft_device_limit_remove))
            }
        }
    }
}

@Composable
internal fun platformLabel(platform: String): String = when (platform) {
    "android" -> stringResource(Res.string.paycraft_device_platform_android)
    "ios" -> stringResource(Res.string.paycraft_device_platform_ios)
    "web" -> stringResource(Res.string.paycraft_device_platform_web)
    else -> stringResource(Res.string.paycraft_device_platform_desktop)
}
