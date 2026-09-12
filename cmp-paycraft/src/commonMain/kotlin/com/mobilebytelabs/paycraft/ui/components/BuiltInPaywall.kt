/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Layer 4 of the resilience chain: the last-resort paywall.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_builtin_disclaimer
import com.mobilebytelabs.paycraft.generated.resources.paycraft_builtin_priced_label
import com.mobilebytelabs.paycraft.generated.resources.paycraft_builtin_reload
import com.mobilebytelabs.paycraft.generated.resources.paycraft_builtin_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_builtin_trial_label
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.sessionDisplayPriceFormatted

/**
 * Rendered when network, persisted cache and bundled fallback have all failed, but the SDK can
 * still name at least one product.
 *
 * WHY THIS IS A PAYWALL AND NOT AN ERROR SCREEN
 * A user who arrived here wants to buy something. Config resolution failing is our problem, not
 * theirs, and showing an error where a purchase button belongs converts an infrastructure blip
 * into lost revenue and a worse experience than a plain list of plans. So this renders the
 * minimum honest thing: what the plans are, a way to buy, and a way to retry.
 *
 * It is deliberately unstyled beyond the theme — no hero, no template, no remote copy. Everything
 * that would have made it prettier is exactly the data that is missing.
 */
@Composable
fun BuiltInPaywall(
    products: List<Product>,
    onPickProduct: (Product) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_builtin_title),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(Res.string.paycraft_builtin_disclaimer),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        products.sortedBy { it.displayOrder }.forEach { product ->
            Button(
                onClick = { onPickProduct(product) },
                modifier = Modifier.fillMaxWidth().testTag(PayCraftTestTags.PAYWALL_CTA),
            ) {
                // Price comes from whatever the SDK last knew. A Trial carries no price at all, so
                // it shows its name and duration — never a fabricated number, because a wrong price
                // on a purchase button is far worse than no price.
                val label = when (product) {
                    is Product.Subscription -> stringResource(
                        Res.string.paycraft_builtin_priced_label,
                        product.displayName, product.sessionDisplayPriceFormatted().orEmpty(),
                    )
                    is Product.Lifetime -> stringResource(
                        Res.string.paycraft_builtin_priced_label,
                        product.displayName, product.sessionDisplayPriceFormatted().orEmpty(),
                    )
                    // The English "-day trial" suffix was concatenated onto a number; it is now a
                    // whole parameterised phrase so a translator can order the units naturally.
                    is Product.Trial -> stringResource(
                        Res.string.paycraft_builtin_trial_label,
                        product.displayName, product.durationDays,
                    )
                }
                Text(label)
            }
        }

        OutlinedButton(
            onClick = onRetry,
            modifier = Modifier.fillMaxWidth().testTag(PayCraftTestTags.CONFIG_FAILED_RETRY),
        ) {
            Text("Reload plans")
        }
    }
}
