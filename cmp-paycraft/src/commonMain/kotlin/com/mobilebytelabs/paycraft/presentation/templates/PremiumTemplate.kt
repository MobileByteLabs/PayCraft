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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.MobileByteSenseiTheme
import com.mobilebytelabs.paycraft.presentation.components.PlanCard

/**
 * Premium template — bold typography, light theme with primary-accented surface,
 * marketing-grade hero copy. Uses [MobileByteSenseiTheme.colorsLight].
 */
@Composable
fun PremiumTemplate(state: BillingState, products: List<Product>, onPick: (Product) -> Unit, onRetry: () -> Unit) {
    val bg = MobileByteSenseiTheme.colorsLight.background
    Box(
        Modifier
            .fillMaxSize()
            .background(bg)
            .padding(20.dp),
    ) {
        when (state) {
            is BillingState.Loading -> PremiumLoading()
            is BillingState.Free -> PremiumFree(products, onPick)
            is BillingState.Premium -> PremiumActive(state)
            is BillingState.Error -> PremiumError(state.message, onRetry)
            is BillingState.DeviceConflict -> PremiumDeviceConflict(state)
            is BillingState.OwnershipVerified -> PremiumOwnershipVerified(state)
        }
    }
}

@Composable
private fun PremiumLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Text(
                "Loading…",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PremiumFree(products: List<Product>, onPick: (Product) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            "Upgrade to Premium",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(
            "Unlock everything PayCraft has to offer.",
            style = MaterialTheme.typography.bodyLarge,
        )
        products.forEach { p -> PlanCard(product = p, onClick = { onPick(p) }, popular = true) }
    }
}

@Composable
private fun PremiumActive(s: BillingState.Premium) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "You're Premium",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.ExtraBold,
        )
        s.trial?.let { Text("Trial ends in ${it.daysRemaining} days · Welcome aboard.") }
        Text("Active plan: ${s.status.plan}")
        Text("Renews ${s.status.expiresAt}")
    }
}

@Composable
private fun PremiumError(msg: String, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "We hit a snag",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(msg)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun PremiumDeviceConflict(s: BillingState.DeviceConflict) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Subscription bound to another device",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text("Existing device: ${s.conflictingDeviceName ?: "another device"}")
        Text("Email on file: ${s.email}")
        Text("Reach support at ${s.supportEmail} if you don't recognize this device.")
    }
}

@Composable
private fun PremiumOwnershipVerified(s: BillingState.OwnershipVerified) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Verified via ${s.verifiedVia.name.lowercase()}",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text("Confirm to transfer your subscription to this device.")
    }
}
