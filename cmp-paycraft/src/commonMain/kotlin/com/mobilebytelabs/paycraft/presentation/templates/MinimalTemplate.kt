package com.mobilebytelabs.paycraft.presentation.templates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.MobileByteSenseiTheme
import com.mobilebytelabs.paycraft.presentation.components.PlanCard

/**
 * Minimal template — flat surface, light theme, modest typography.
 * Uses [MobileByteSenseiTheme.colorsLight] as its base palette.
 */
@Composable
fun MinimalTemplate(state: BillingState, products: List<Product>, onPick: (Product) -> Unit, onRetry: () -> Unit) {
    val bg = MobileByteSenseiTheme.colorsLight.background
    Box(
        Modifier
            .fillMaxSize()
            .background(bg),
    ) {
        when (state) {
            is BillingState.Loading -> MinimalLoading()
            is BillingState.Free -> MinimalFree(products, onPick)
            is BillingState.Premium -> MinimalPremium(state)
            is BillingState.Error -> MinimalError(state.message, onRetry)
            is BillingState.DeviceConflict -> MinimalDeviceConflict(state)
            is BillingState.OwnershipVerified -> MinimalOwnershipVerified(state)
        }
    }
}

@Composable
private fun MinimalLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Text("Loading…", style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun MinimalFree(products: List<Product>, onPick: (Product) -> Unit) {
    Column(
        Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Upgrade to Premium", style = MaterialTheme.typography.headlineLarge)
        products.forEach { p -> PlanCard(product = p, onClick = { onPick(p) }) }
    }
}

@Composable
private fun MinimalPremium(s: BillingState.Premium) {
    Column(
        Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("You're Premium ✓", style = MaterialTheme.typography.headlineLarge)
        s.trial?.let { Text("Trial ends in ${it.daysRemaining} days") }
        Text("Plan: ${s.status.plan} · Renews ${s.status.expiresAt}")
    }
}

@Composable
private fun MinimalError(msg: String, onRetry: () -> Unit) {
    Column(
        Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Something went wrong", style = MaterialTheme.typography.titleLarge)
        Text(msg)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun MinimalDeviceConflict(s: BillingState.DeviceConflict) {
    Column(
        Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Subscription bound to another device", style = MaterialTheme.typography.titleLarge)
        Text("Last seen on ${s.conflictingDeviceName ?: "another device"} at ${s.conflictingLastSeen ?: "unknown"}")
        Text("Email: ${s.email}")
    }
}

@Composable
private fun MinimalOwnershipVerified(s: BillingState.OwnershipVerified) {
    Column(
        Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Verified via ${s.verifiedVia.name.lowercase()}", style = MaterialTheme.typography.titleLarge)
        Text("Transferring subscription to this device…")
    }
}
