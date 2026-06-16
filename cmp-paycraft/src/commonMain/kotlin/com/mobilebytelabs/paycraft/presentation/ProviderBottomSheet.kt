package com.mobilebytelabs.paycraft.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.config.ProviderDto

/**
 * Modal bottom sheet that lets the user choose a payment provider after selecting a plan.
 *
 * Shown by [ProviderPicker.AutoSkipWhenSingle] when 2+ providers are available,
 * or always when [ProviderPicker.BottomSheet] is the active strategy.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderBottomSheet(
    providers: List<ProviderDto>,
    maxVisible: Int = 4,
    onProviderPicked: (ProviderDto) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 32.dp)) {
            Text(
                text = "How would you like to pay?",
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.height(12.dp))
            val visible = providers.take(maxVisible)
            val overflow = providers.drop(maxVisible)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visible, key = { it.provider }) { p ->
                    ProviderRow(p) { onProviderPicked(p) }
                }
                if (overflow.isNotEmpty()) {
                    item {
                        ExpandableMoreProviders(overflow, onProviderPicked)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProviderRow(provider: ProviderDto, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProviderBadge(provider.provider)
            Spacer(Modifier.width(12.dp))
            Text(
                text = displayLabelFor(provider.provider),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@Composable
private fun ProviderBadge(providerKey: String) {
    // v2.0: text badge per provider; icon assets ship in v2.0.x
    val short = when (providerKey) {
        "stripe" -> "S"
        "razorpay" -> "R"
        "paypal" -> "P"
        "paddle" -> "Pd"
        else -> providerKey.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    }
    Surface(
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.primary,
    ) {
        Box(
            modifier = Modifier.size(40.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = short,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}

@Composable
private fun ExpandableMoreProviders(rest: List<ProviderDto>, onPick: (ProviderDto) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }) {
        Text(
            text = if (expanded) "Hide" else "More payment methods (${rest.size})",
        )
    }
    if (expanded) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            rest.forEach { p ->
                ProviderRow(p) { onPick(p) }
            }
        }
    }
}

internal fun displayLabelFor(providerKey: String): String = when (providerKey) {
    "stripe" -> "Card / UPI / Wallet (Stripe)"
    "razorpay" -> "All Indian methods (Razorpay)"
    "paypal" -> "PayPal"
    "paddle" -> "Card (Paddle)"
    "lemon_squeezy" -> "Card (Lemon Squeezy)"
    "flutterwave" -> "Flutterwave"
    "paystack" -> "Paystack"
    "midtrans" -> "Midtrans"
    else -> providerKey.split('_').joinToString(" ") { it.replaceFirstChar { c -> c.uppercaseChar() } }
}
