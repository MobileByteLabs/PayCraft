/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Manage devices — one subscription, up to N active devices (server 178+).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_devices_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_devices_in_use
import com.mobilebytelabs.paycraft.generated.resources.paycraft_devices_title
import com.mobilebytelabs.paycraft.network.ActiveDevice
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

/**
 * "Your devices": every device holding a seat of the subscription, this one first and marked, each with
 * its own "Sign out" — the streaming-service model of one subscription on phone, tablet and web.
 * Signing out THIS device logs the app out. Drop it into the app's account / settings screen.
 */
@Composable
fun PayCraftManageDevices(modifier: Modifier = Modifier, repository: PayCraftRepository = koinInject()) {
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<ActiveDevice>>(emptyList()) }
    LaunchedEffect(repository) { devices = repository.activeDevices() }
    PayCraftDevicesContent(
        devices = devices,
        maxDevices = devices.firstOrNull()?.maxDevices ?: 1,
        onSignOut = { ref ->
            scope.launch {
                if (repository.signOutDevice(ref)) devices = repository.activeDevices()
            }
        },
        modifier = modifier,
    )
}

/** The stateless list: rendered and asserted on directly in tests. */
@Composable
fun PayCraftDevicesContent(
    devices: List<ActiveDevice>,
    maxDevices: Int,
    onSignOut: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_devices_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = stringResource(Res.string.paycraft_devices_body, maxDevices),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(Res.string.paycraft_devices_in_use, devices.size, maxDevices),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        devices.forEach { ActiveDeviceRow(it, onSignOut) }
    }
}
