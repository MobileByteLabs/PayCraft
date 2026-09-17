package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * The entitled surface: what a paying subscriber sees instead of a paywall.
 *
 * Promoted out of `BrandedStackTemplate` rather than newly written. Each of the four templates had
 * its own copy of this — the same icon, headline, plan line and trial line with cosmetic wording
 * differences ("You're Premium" vs "You're Premium ✓") that no tenant chose and none could change.
 * A component tree cannot express this arm: it is authored by no one, has no packages to select and
 * nothing to purchase, so it stays Kotlin while the paywall itself becomes data.
 */
@Composable
fun PremiumStatusContent(state: BillingState.Premium) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Filled.Check,
            contentDescription = null,
            tint = tokens.colors.accent,
            modifier = Modifier.size(64.dp),
        )
        Text(
            text = "You're Premium",
            color = tokens.colors.onSurface,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
        )
        state.status.plan?.let {
            Text(text = "Plan: $it", color = tokens.colors.onSurfaceVariant, fontSize = 14.sp)
        }
        state.status.expiresAt?.let {
            Text(text = "Renews $it", color = tokens.colors.onSurfaceVariant, fontSize = 12.sp)
        }
        state.trial?.let {
            Text(
                text = "Trial: ${it.daysRemaining} days remaining",
                color = tokens.colors.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
    }
}
