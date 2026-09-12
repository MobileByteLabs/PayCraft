package com.mobilebytelabs.paycraft.presentation.templates

import androidx.compose.foundation.layout.Arrangement
import com.mobilebytelabs.paycraft.ui.components.PremiumEntitlementActions
import com.mobilebytelabs.paycraft.ui.components.OwnershipVerifiedContent
import com.mobilebytelabs.paycraft.ui.components.DeviceConflictContent
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.components.PlanCard
import com.mobilebytelabs.paycraft.ui.components.PaymentPendingContent
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.paywallRoot
import com.mobilebytelabs.paycraft.ui.theme.PayCraftBrandColorsLight

/**
 * Minimal template — flat surface, light theme, modest typography.
 * Uses [PayCraftBrandColorsLight] (the PayCraft brand light scheme) as its base palette.
 */
@Composable
fun MinimalTemplate(state: BillingState, products: List<Product>, onPick: (Product) -> Unit, onRetry: () -> Unit, onAction: (PayCraftPaywallAction) -> Unit = {}) {
    val bg = PayCraftBrandColorsLight.background
    Box(Modifier.paywallRoot(bg)) {
        when (state) {
            is BillingState.Loading -> MinimalLoading()
            is BillingState.Free -> MinimalFree(products, onPick)
            is BillingState.Premium -> Column {
                MinimalPremium(state)
                PremiumEntitlementActions(onAction)
            }
            is BillingState.Error -> MinimalError(state.message, onRetry)
            is BillingState.PaymentPending -> PaymentPendingContent(state.productId)
            is BillingState.DeviceConflict -> DeviceConflictContent(state, onAction)
            is BillingState.OwnershipVerified -> OwnershipVerifiedContent(state, onAction)
        }
    }
}

@Composable
private fun MinimalLoading() {
    // Phase 3 (AC-5, AC-14): shared PaywallSkeleton — no CircularProgressIndicator
    // on any state=Loading branch across the SDK.
    PaywallSkeleton(planCount = 3)
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

