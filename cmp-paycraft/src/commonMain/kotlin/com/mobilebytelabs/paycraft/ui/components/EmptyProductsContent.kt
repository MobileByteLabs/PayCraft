/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Empty-products surface (AC-26).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_retry
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_title

/**
 * Shown when config resolved but carries no purchasable products.
 *
 * Replaces a hero, a list with nothing in it, and a DISABLED buy button — a screen that asked the
 * user to purchase while making purchase impossible, and offered no explanation or way forward.
 * A disabled control with no adjacent reason is indistinguishable from a broken app.
 *
 * This is NOT the config-failure surface: config loaded fine and genuinely contains no products,
 * which is usually a tenant misconfiguration. The copy stays neutral about whose fault that is.
 */
@Composable
fun EmptyProductsContent(
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_empty_products_title),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(Res.string.paycraft_empty_products_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(PayCraftTestTags.EMPTY_PRODUCTS_MESSAGE),
        )
        Button(
            onClick = { onAction(PayCraftPaywallAction.RefreshStatus) },
            modifier = Modifier.testTag(PayCraftTestTags.EMPTY_PRODUCTS_RETRY),
        ) { Text(stringResource(Res.string.paycraft_empty_products_retry)) }
    }
}
