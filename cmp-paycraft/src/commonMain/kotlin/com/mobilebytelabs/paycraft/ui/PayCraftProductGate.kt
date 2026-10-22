package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import org.koin.compose.koinInject

/**
 * Shows [content] only when the user owns the one-time product [sku].
 *
 * This is the ONE-TIME-UNLOCK counterpart to the subscription gates in `PayCraftGates.kt`:
 * `isPremium` answers "entitled to anything premium", this answers "owns THIS sku". A store that
 * only knew the former would keep selling a lifetime unlock to someone who had already bought it.
 *
 * ## Closed until the server says otherwise
 *
 * Ownership starts false and only opens once [PayCraftRepository.refreshOwnership] returns true.
 * It deliberately does NOT open optimistically when a purchase flow returns success: Play and
 * StoreKit can both report success for a transaction that later fails verification, and a gate
 * that trusted the client would hand over paid content for a purchase that never settled.
 *
 * The inverse matters as much — the refresh REMOVES a sku on a false, so a refund or a failed
 * re-verification closes a gate an earlier purchase opened. A gate that only ever opened would
 * stay open forever after the first true.
 *
 * Renders nothing while unowned — no placeholder, no upsell. What to show a non-owner is a product
 * decision (a locked row, a store section, nothing at all), so the host composes that around this
 * rather than inheriting a default it then has to fight. Takes no purchase callback (AR-014).
 */
@Composable
public fun PayCraftProductGate(sku: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val repository: PayCraftRepository = koinInject()
    val owned by repository.ownedSkus.collectAsStateWithLifecycle()

    // Keyed on sku so a changed product re-reads rather than reusing the previous verdict.
    LaunchedEffect(sku) { repository.refreshOwnership(sku) }

    if (sku in owned) {
        Box(
            modifier = modifier.testTag(PayCraftTestTags.PRODUCT_GATE_UNLOCKED),
        ) {
            content()
        }
    }
}
