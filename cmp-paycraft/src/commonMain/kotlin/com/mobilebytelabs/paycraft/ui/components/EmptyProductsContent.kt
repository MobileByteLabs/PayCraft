/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Empty-products surface (AC-26).
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_retry
import com.mobilebytelabs.paycraft.generated.resources.paycraft_empty_products_title
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource

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
fun EmptyProductsContent(onAction: (PayCraftPaywallAction) -> Unit, modifier: Modifier = Modifier) {
    PaywallStateScreen(
        modifier = modifier,
        hero = {
            PaywallStateHero(
                icon = Icons.Outlined.StarOutline,
                title = stringResource(Res.string.paycraft_empty_products_title),
                body = stringResource(Res.string.paycraft_empty_products_body),
                bodyModifier = Modifier.testTag(PayCraftTestTags.EMPTY_PRODUCTS_MESSAGE),
            )
        },
        primary = {
            PaywallPrimaryButton(
                text = stringResource(Res.string.paycraft_empty_products_retry),
                onClick = { onAction(PayCraftPaywallAction.RefreshStatus) },
                modifier = Modifier.testTag(PayCraftTestTags.EMPTY_PRODUCTS_RETRY),
            )
        },
        onRestore = { onAction(PayCraftPaywallAction.OpenRestoreSheet) },
    )
}
