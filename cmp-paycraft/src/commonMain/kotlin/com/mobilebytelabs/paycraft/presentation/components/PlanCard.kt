package com.mobilebytelabs.paycraft.presentation.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Renders a single product card — variant per [Product] subtype:
 *  - [Product.Subscription] → "${displayName} · ${formattedPrice}/${interval}"
 *  - [Product.Trial] → "${displayName} · Free for ${durationDays} days"
 *  - [Product.Lifetime] → "${displayName} · ${formattedPrice} (one-time)"
 *
 * When [popular] is true the card gains a 2 dp accent-coloured border ring and a
 * "MOST POPULAR" pill badge that overlaps the top edge of the card.
 */
@Composable
fun PlanCard(product: Product, onClick: () -> Unit, modifier: Modifier = Modifier, popular: Boolean = false) {
    val secondary = when (product) {
        is Product.Subscription -> "${product.basePrice.format()} / ${product.interval.label()}"
        is Product.Trial -> "Free for ${product.durationDays} days"
        is Product.Lifetime -> "${product.basePrice.format()} (one-time)"
    }

    // Top padding reserves space so the badge can overlap the card's top edge without
    // clipping. Only applied when the card is popular; non-popular path is unchanged.
    val cardTopPadding = if (popular) 12.dp else 4.dp

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = cardTopPadding, bottom = 4.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
            border = if (popular) {
                BorderStroke(
                    width = 2.dp,
                    color = PayCraftTheme.colors.popularBadge,
                )
            } else {
                null
            },
            shape = RoundedCornerShape(PayCraftTheme.shape.planCard),
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
                }
                Text(
                    text = secondary,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // "MOST POPULAR" pill — sits at the very top of the Box, overlapping the card's
        // top border. Rendered only for popular cards.
        if (popular) {
            Surface(
                modifier = Modifier
                    .wrapContentSize()
                    .offset(y = (-1).dp), // tuck badge half-over the card's top border
                color = PayCraftTheme.colors.popularBadge,
                shape = RoundedCornerShape(PayCraftTheme.shape.badge),
            ) {
                Text(
                    text = "MOST POPULAR",
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = PayCraftTheme.colors.onPopularBadge,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
            }
        }
    }
}

private fun Product.Subscription.Interval.label(): String = when (this) {
    Product.Subscription.Interval.MONTH -> "month"
    Product.Subscription.Interval.QUARTER -> "quarter"
    Product.Subscription.Interval.SEMIANNUAL -> "6 months"
    Product.Subscription.Interval.YEAR -> "year"
}
