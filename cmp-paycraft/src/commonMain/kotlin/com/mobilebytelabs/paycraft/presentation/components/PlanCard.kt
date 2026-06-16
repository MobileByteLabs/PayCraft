package com.mobilebytelabs.paycraft.presentation.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.Product

/**
 * Renders a single product card — variant per [Product] subtype:
 *  - [Product.Subscription] → "${displayName} · ${formattedPrice}/${interval}"
 *  - [Product.Trial] → "${displayName} · Free for ${durationDays} days"
 *  - [Product.Lifetime] → "${displayName} · ${formattedPrice} (one-time)"
 */
@Composable
fun PlanCard(product: Product, onClick: () -> Unit, modifier: Modifier = Modifier, popular: Boolean = false) {
    val secondary = when (product) {
        is Product.Subscription -> "${product.basePrice.format()} / ${product.interval.label()}"
        is Product.Trial -> "Free for ${product.durationDays} days"
        is Product.Lifetime -> "${product.basePrice.format()} (one-time)"
    }
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier
                .padding(PaddingValues(horizontal = 16.dp, vertical = 12.dp))
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = product.displayName,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                if (popular) {
                    Text(
                        text = "Popular",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Text(
                text = secondary,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun Product.Subscription.Interval.label(): String = when (this) {
    Product.Subscription.Interval.MONTH -> "month"
    Product.Subscription.Interval.QUARTER -> "quarter"
    Product.Subscription.Interval.SEMIANNUAL -> "6 months"
    Product.Subscription.Interval.YEAR -> "year"
}
