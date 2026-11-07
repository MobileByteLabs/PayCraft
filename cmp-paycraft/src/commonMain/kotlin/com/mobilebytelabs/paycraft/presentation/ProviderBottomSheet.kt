package com.mobilebytelabs.paycraft.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_picker_close_cd
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_picker_hide
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_picker_more
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_picker_secure
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_picker_title
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

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
    selectedPlan: BillingPlan? = null,
    maxVisible: Int = 4,
    onProviderPicked: (ProviderDto) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = PayCraftTheme.colors.surface,
    ) {
        ProviderPickerContent(
            providers = providers,
            selectedPlan = selectedPlan,
            maxVisible = maxVisible,
            onProviderPicked = onProviderPicked,
            onDismiss = onDismiss,
        )
    }
}

/**
 * Provider picker WITHOUT its own modal window.
 *
 * Split out of [ProviderBottomSheet] so a paywall that is itself already inside a
 * [ModalBottomSheet] can swap this content into that ONE sheet instead of opening a second modal
 * window on top of it. Nested modal sheets each carry their own scrim and window, which stack
 * unpredictably and darken the sheet underneath (UI-3).
 *
 * Layout follows Stitch sdk-paywall 04: title + close, the plan summary row between hairlines, one
 * row per provider (brand tile, name, what it accepts), and the security footnote.
 *
 * BEHAVIOUR DIFFERS FROM STITCH ON PURPOSE: Stitch draws radios with an implied confirm step. Here a
 * row tap starts that provider's checkout immediately — the existing purchase contract
 * ([PayCraftPaywallAction.CheckoutWithProvider] per tap). So rows carry a chevron, not a radio, and
 * the locale-recommended provider is ringed rather than "selected": a radio that does not select
 * would lie about what the tap does.
 *
 * [ProviderBottomSheet] remains the right entry point when the paywall is rendered full-screen.
 */
@Composable
fun ProviderPickerContent(
    providers: List<ProviderDto>,
    selectedPlan: BillingPlan? = null,
    maxVisible: Int = 4,
    onProviderPicked: (ProviderDto) -> Unit,
    onDismiss: (() -> Unit)? = null,
) {
    val colors = PayCraftTheme.colors
    val recommended = recommendedProviderKey(providers, selectedPlan)
    Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(Res.string.paycraft_provider_picker_title),
                color = colors.onSurface,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (onDismiss != null) {
                val closeCd = stringResource(Res.string.paycraft_provider_picker_close_cd)
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(colors.onSurface.copy(alpha = 0.06f))
                        .semantics { contentDescription = closeCd },
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = null,
                        tint = colors.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = colors.divider)
        if (selectedPlan != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = selectedPlan.name,
                    color = colors.onSurfaceVariant,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "${selectedPlan.price} / ${planIntervalSuffix(selectedPlan.interval)}",
                    color = colors.onSurface,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            HorizontalDivider(color = colors.divider)
        }
        Spacer(Modifier.height(16.dp))

        val visible = providers.take(maxVisible)
        val overflow = providers.drop(maxVisible)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(visible, key = { it.provider }) { p ->
                ProviderRow(
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

        Spacer(Modifier.height(20.dp))
        SecureFooter()
    }
}

@Composable
private fun ProviderRow(provider: ProviderDto, isRecommended: Boolean, onClick: () -> Unit) {
    val colors = PayCraftTheme.colors
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (isRecommended) colors.accent.copy(alpha = 0.08f) else colors.onSurface.copy(alpha = 0.03f))
            .border(
                width = if (isRecommended) 1.5.dp else 1.dp,
                color = if (isRecommended) colors.accent else colors.onSurface.copy(alpha = 0.14f),
                shape = shape,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProviderBadge(provider.provider)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = displayLabelFor(provider.provider),
                color = colors.onSurface,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = taglineFor(provider.provider),
                color = colors.onSurfaceVariant,
                fontSize = 13.sp,
            )
        }
        Spacer(Modifier.width(8.dp))
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = if (isRecommended) colors.accent else colors.onSurfaceVariant,
            modifier = Modifier.size(22.dp),
        )
    }
}

/** Rounded-square brand tile (Stitch 04). Bundled marks keep their own brand fill. */
@Composable
private fun ProviderBadge(providerKey: String) {
    val icon = providerIconFor(providerKey)
    val brand = brandColorFor(providerKey)
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(shape)
            .background(if (icon != null) Color.White else brand)
            .border(1.dp, PayCraftTheme.colors.divider, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = providerKey,
                tint = Color.Unspecified,
                modifier = Modifier.size(26.dp),
            )
        } else {
            // Fallback for providers without a bundled icon — initials on brand colour.
            Text(
                text = providerKey.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun SecureFooter() {
    val colors = PayCraftTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Outlined.Lock,
            contentDescription = null,
            tint = colors.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = stringResource(Res.string.paycraft_provider_picker_secure),
            color = colors.onSurfaceVariant,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun ExpandableMoreProviders(rest: List<ProviderDto>, onPick: (ProviderDto) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }) {
        Text(
            text = if (expanded) {
                stringResource(Res.string.paycraft_provider_picker_hide)
            } else {
                stringResource(Res.string.paycraft_provider_picker_more, rest.size)
            },
        )
    }
    if (expanded) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            rest.forEach { p ->
                ProviderRow(p, isRecommended = false) { onPick(p) }
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
    "stripe" -> Color(0xFF635BFF) // Stripe purple
    "razorpay" -> Color(0xFF3395FF) // Razorpay blue
    "paypal" -> Color(0xFF003087) // PayPal blue
    "paddle" -> Color(0xFF1A237E) // Paddle dark blue
    "lemon_squeezy" -> Color(0xFFFFC233) // LS yellow
    "flutterwave" -> Color(0xFFF1592A) // Flutterwave orange
    "paystack" -> Color(0xFF00C3F7) // Paystack cyan
    "midtrans" -> Color(0xFF005DAB) // Midtrans blue
    else -> Color(0xFF6750A4) // M3 fallback
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
        else -> if ("stripe" in keys) {
            "stripe"
        } else if ("paddle" in keys) {
            "paddle"
        } else if ("paypal" in keys) {
            "paypal"
        } else {
            null
        }
    }
}

internal fun planIntervalSuffix(interval: String): String = when (interval) {
    // String-keyed, so the compiler cannot flag a missing cadence here the way it does for the
    // Interval enum. The `else` arm echoes the raw value, which for "week" would read "/ week"
    // by luck rather than design — stated explicitly so it stays correct if the wording changes.
    "week" -> "week"
    "month" -> "month"
    "quarter" -> "quarter"
    "semiannual" -> "6 months"
    "year" -> "year"
    "lifetime" -> "one time"
    else -> interval
}
