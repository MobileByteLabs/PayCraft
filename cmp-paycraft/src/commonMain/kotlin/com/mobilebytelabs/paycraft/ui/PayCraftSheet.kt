package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Conditional bottom-sheet paywall.
 *
 * Shows the paywall as a [PayCraftPaywallSheet] when [visible] is `true`.
 * Dismisses and calls [onDismiss] when the user closes it.
 *
 * Usage:
 * ```kotlin
 * var showPaywall by remember { mutableStateOf(false) }
 *
 * PayCraftSheet(
 *     visible = showPaywall,
 *     onDismiss = { showPaywall = false },
 * )
 * ```
 */
@Composable
fun PayCraftSheet(visible: Boolean, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    if (visible) {
        PayCraftPaywallSheet(
            onDismiss = onDismiss,
            modifier = modifier,
        )
    }
}
