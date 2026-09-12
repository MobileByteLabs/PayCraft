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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.components.PlanCard
import com.mobilebytelabs.paycraft.ui.components.PaymentPendingContent
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.paywallRoot
import com.mobilebytelabs.paycraft.ui.theme.PayCraftBrandColorsLight

/**
 * Premium template — bold typography, light theme with primary-accented surface,
 * marketing-grade hero copy. Uses [PayCraftBrandColorsLight] (the PayCraft
 * brand light scheme).
 */
@Composable
fun PremiumTemplate(state: BillingState, products: List<Product>, onPick: (Product) -> Unit, onRetry: () -> Unit, onAction: (PayCraftPaywallAction) -> Unit = {}) {
    val bg = PayCraftBrandColorsLight.background
    Box(
        Modifier
            .paywallRoot(bg)
            .padding(20.dp),
    ) {
        when (state) {
            is BillingState.Loading -> PremiumLoading()
            is BillingState.Free -> PremiumFree(products, onPick)
            is BillingState.Premium -> Column {
                PremiumActive(state)
                PremiumEntitlementActions(onAction)
            }
            is BillingState.Error -> PremiumError(state.message, onRetry)
            is BillingState.PaymentPending -> PaymentPendingContent(state.productId)
            is BillingState.DeviceConflict -> DeviceConflictContent(state, onAction)
            is BillingState.OwnershipVerified -> OwnershipVerifiedContent(state, onAction)
        }
    }
}

@Composable
private fun PremiumLoading() {
    // Phase 3 (AC-5, AC-14): deprecated template Loading branch delegates to
    // the shared PaywallSkeleton so no `CircularProgressIndicator` remains on
    // any state=Loading path. Reduced-motion is honored via the skeleton's own
    // static-background collapse.
    PaywallSkeleton(planCount = 3)
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

