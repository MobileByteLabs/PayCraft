package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import org.koin.compose.koinInject

/**
 * The non-subscription store — consumable packs and one-time unlocks, each buyable in one tap.
 *
 * ## What it deliberately does not do
 *
 * It takes **no purchase callback** (AR-014). On 2026-10-19 a host-callback surface shipped with a
 * dead upgrade row: it reported `clickable=true`, its handler ran, its golden matched and its logic
 * tests passed — and only an on-device render caught that nothing happened. A surface that owns its
 * own presentation cannot fail that way, so this calls [PayCraftRepository.checkout] directly.
 *
 * It also lists only the non-subscription catalogue — subscriptions and trials are excluded, because a store
 * that offers a plan beside a coin pack invites a user to buy a subscription they may already hold.
 *
 * Balances are NOT shown per row. A pack's balance is the balance of the currency it grants, not of
 * the pack sku, and only the host knows how it wants to present its own currency. Hosts render
 * [PayCraftBalance] (or read `repository.balances`) wherever that belongs in their chrome.
 */
@Composable
public fun PayCraftStoreSection(modifier: Modifier = Modifier) {
    val repository: PayCraftRepository = koinInject()
    // Collected rather than read once: a dashboard edit (new pack, changed price) reaches an open
    // store without a cold relaunch, and the paywall reads the SAME flow, so the two surfaces
    // cannot disagree about a price.
    val plans by repository.plans.collectAsStateWithLifecycle()
    val products = plans.filter { it.isConsumable || it.interval == "lifetime" }

    Column(
        modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.STORE_SECTION),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (products.isEmpty()) {
            // An empty catalogue is a configuration state, not an error: a tenant may sell only
            // subscriptions. Say so plainly rather than rendering an empty box the host cannot
            // distinguish from a failed load.
            Text(
                text = "No products available",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag(PayCraftTestTags.STORE_EMPTY),
            )
            return@Column
        }

        products.forEach { product ->
            StoreProductRow(
                product = product,
                onBuy = { repository.checkout(product) },
            )
        }
    }
}

/**
 * One purchasable row — name, what it grants, price.
 *
 * The grant line renders only for a consumable with a known quantity. A pack whose
 * [BillingPlan.grantQuantity] is 0 is misconfigured server-side, and printing "0" would read as a
 * deliberate offer of nothing; omitting the line makes the gap visible to whoever configured it
 * without lying to the buyer.
 */
@Composable
private fun StoreProductRow(product: BillingPlan, onBuy: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .testTag(PayCraftTestTags.STORE_PRODUCT_ROW)
            .clickable(onClick = onBuy),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(text = product.name, style = MaterialTheme.typography.titleSmall)
                if (product.isConsumable && product.grantQuantity > 0) {
                    Text(
                        text = "Grants ${product.grantQuantity}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(text = product.price, style = MaterialTheme.typography.titleSmall)
        }
    }
}
