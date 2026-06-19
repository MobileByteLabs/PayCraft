package com.mobilebytelabs.paycraft.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Modal bottom sheet that lets the user choose a payment provider after selecting a plan.
 *
 * Shown by [ProviderPicker.AutoSkipWhenSingle] when 2+ providers are available,
 * or always when [ProviderPicker.BottomSheet] is the active strategy.
 *
 * Layout per provider: brand-coloured tile + provider name + locale-aware
 * recommendation badge + concrete payment-method chips (so the buyer can see
 * exactly which methods they'll be offered before committing).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderBottomSheet(
    providers: List<ProviderDto>,
    selectedPlan: BillingPlan? = null,
    maxVisible: Int = 4,
    onProviderPicked: (ProviderDto) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val recommended = recommendedProviderKey(providers, selectedPlan)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 32.dp)) {
            // Header — title + plan summary
            Text(
                text = "Choose a payment method",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            if (selectedPlan != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "${selectedPlan.name} · ${selectedPlan.price}/${planIntervalSuffix(selectedPlan.interval)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(16.dp))

            val visible = providers.take(maxVisible)
            val overflow = providers.drop(maxVisible)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(visible, key = { it.provider }) { p ->
                    ProviderTile(
                        provider = p,
                        isRecommended = p.provider == recommended,
                        onClick = { onProviderPicked(p) },
                    )
                }
                if (overflow.isNotEmpty()) {
                    item {
                        ExpandableMoreProviders(overflow, onProviderPicked)
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            SecureFooter()
        }
    }
}

@Composable
private fun ProviderTile(
    provider: ProviderDto,
    isRecommended: Boolean,
    onClick: () -> Unit,
) {
    val brand = brandColorFor(provider.provider)
    val borderColor = if (isRecommended) brand else Color.Transparent
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = if (isRecommended) 2.dp else 0.dp,
                color = borderColor,
                shape = RoundedCornerShape(12.dp),
            ),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            if (isRecommended) {
                RecommendedBadge(brand)
                Spacer(Modifier.height(8.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProviderBadge(provider.provider, brand)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = displayLabelFor(provider.provider),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = taglineFor(provider.provider),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            MethodChips(methodsFor(provider.provider))
        }
    }
}

@Composable
private fun ProviderBadge(providerKey: String, brand: Color) {
    val icon = providerIconFor(providerKey)
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (icon != null) Color.White else brand),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            // Render the brand wordmark inset within the white circle so the
            // mark reads cleanly at small sizes; the icon's own SolidColor
            // fill carries the brand color.
            Icon(
                imageVector = icon,
                contentDescription = providerKey,
                tint = Color.Unspecified,
                modifier = Modifier.size(26.dp),
            )
        } else {
            // Fallback for providers without a bundled icon — initials on brand colour.
            val short = providerKey.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
            Text(
                text = short,
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun RecommendedBadge(brand: Color) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = brand.copy(alpha = 0.12f),
    ) {
        Text(
            text = "Recommended for you",
            style = MaterialTheme.typography.labelSmall,
            color = brand,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun MethodChips(methods: List<String>) {
    // Plain Row + manual wrap into rows of 3-4 chips per row. Avoids depending
    // on FlowRow (material3 wrapper) to keep KMP common-source bundle lean.
    val rows = methods.chunked(3)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { m -> MethodChip(m) }
            }
        }
    }
}

@Composable
private fun MethodChip(label: String) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun SecureFooter() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "🔒  Payments processed securely by your selected provider",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ExpandableMoreProviders(rest: List<ProviderDto>, onPick: (ProviderDto) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }) {
        Text(text = if (expanded) "Hide" else "More payment methods (${rest.size})")
    }
    if (expanded) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            rest.forEach { p ->
                ProviderTile(p, isRecommended = false) { onPick(p) }
            }
        }
    }
}

// ─── Provider metadata (display, brand, tagline, methods, locale fit) ─────

internal fun displayLabelFor(providerKey: String): String = when (providerKey) {
    "stripe" -> "Stripe"
    "razorpay" -> "Razorpay"
    "paypal" -> "PayPal"
    "paddle" -> "Paddle"
    "lemon_squeezy" -> "Lemon Squeezy"
    "flutterwave" -> "Flutterwave"
    "paystack" -> "Paystack"
    "midtrans" -> "Midtrans"
    else -> providerKey.split('_').joinToString(" ") { it.replaceFirstChar { c -> c.uppercaseChar() } }
}

internal fun taglineFor(providerKey: String): String = when (providerKey) {
    "stripe" -> "Cards, Apple Pay, Google Pay, and Link"
    "razorpay" -> "UPI, cards, wallets, net banking, and EMI"
    "paypal" -> "PayPal balance, bank, or card"
    "paddle" -> "Cards and digital wallets"
    "lemon_squeezy" -> "Cards and PayPal"
    "flutterwave" -> "Cards, mobile money, and bank transfer"
    "paystack" -> "Cards, bank transfer, and USSD"
    "midtrans" -> "Cards, GoPay, and bank transfer"
    else -> "Secure online payment"
}

internal fun methodsFor(providerKey: String): List<String> = when (providerKey) {
    "stripe" -> listOf("Visa", "Mastercard", "Amex", "Apple Pay", "Google Pay", "Link")
    "razorpay" -> listOf("UPI", "Cards", "Wallets", "Net Banking", "EMI")
    "paypal" -> listOf("PayPal Balance", "Bank", "Cards")
    "paddle" -> listOf("Visa", "Mastercard", "Apple Pay")
    "lemon_squeezy" -> listOf("Cards", "PayPal")
    "flutterwave" -> listOf("Cards", "Mobile Money", "Bank Transfer")
    "paystack" -> listOf("Cards", "Bank", "USSD")
    "midtrans" -> listOf("Cards", "GoPay", "Bank Transfer")
    else -> emptyList()
}

internal fun brandColorFor(providerKey: String): Color = when (providerKey) {
    "stripe" -> Color(0xFF635BFF)        // Stripe purple
    "razorpay" -> Color(0xFF3395FF)      // Razorpay blue
    "paypal" -> Color(0xFF003087)        // PayPal blue
    "paddle" -> Color(0xFF1A237E)        // Paddle dark blue
    "lemon_squeezy" -> Color(0xFFFFC233) // LS yellow
    "flutterwave" -> Color(0xFFF1592A)   // Flutterwave orange
    "paystack" -> Color(0xFF00C3F7)      // Paystack cyan
    "midtrans" -> Color(0xFF005DAB)      // Midtrans blue
    else -> Color(0xFF6750A4)            // M3 fallback
}

/**
 * Locale-aware recommendation. INR plans suggest the India-focused provider
 * (Razorpay); other currencies suggest the international card-first provider
 * (Stripe). Returns null when no provider in [providers] matches the heuristic.
 */
internal fun recommendedProviderKey(providers: List<ProviderDto>, plan: BillingPlan?): String? {
    if (plan == null) return null
    val keys = providers.map { it.provider }.toSet()
    return when (plan.currency.uppercase()) {
        "INR" -> if ("razorpay" in keys) "razorpay" else null
        else -> if ("stripe" in keys) "stripe"
                else if ("paddle" in keys) "paddle"
                else if ("paypal" in keys) "paypal"
                else null
    }
}

internal fun planIntervalSuffix(interval: String): String = when (interval) {
    "month" -> "month"
    "quarter" -> "quarter"
    "semiannual" -> "6 months"
    "year" -> "year"
    "lifetime" -> "one time"
    else -> interval
}
