package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.core.PayCraftBalances
import org.koin.compose.koinInject

/**
 * A server-authoritative consumable balance for one [sku] (API_CONTRACTS.md "Product catalogue &
 * balances").
 *
 * Reads [PayCraftRepository.balances] and refreshes [sku] on first composition. It renders NOTHING
 * until the server has answered — a sku absent from the map has not been read yet, and that is a
 * different thing from a zero balance. Showing "0" during the read would tell a user who just paid
 * that their coins are gone, which is the one message this surface must never produce by accident.
 *
 * Takes no purchase callback and performs no purchase (AR-014): it reports a number, nothing more.
 * Hosts that want their own presentation (cappy renders "⚡ 550" in its own shop chrome) should read
 * `repository.balances` directly rather than restyling this.
 */
@Composable
public fun PayCraftBalance(sku: String, modifier: Modifier = Modifier) {
    // The SDK-owned mirror, not the repository's raw flow: PayCraftBalances is what reconciles the
    // outbox, so reading past it would show a number that ignores offline spends still queued.
    val balanceStore: PayCraftBalances = koinInject()
    val balances by balanceStore.balances.collectAsStateWithLifecycle()

    // Keyed on sku so switching products re-reads rather than showing the previous product's number.
    LaunchedEffect(sku) { balanceStore.reconcile(sku) }

    val balance = balances[sku] ?: return

    Surface(
        modifier = modifier.testTag(PayCraftTestTags.BALANCE),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = MaterialTheme.shapes.large,
    ) {
        Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(
                text = balance.toString(),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.semantics { contentDescription = "Balance: $balance" },
            )
        }
    }
}
