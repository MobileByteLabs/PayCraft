package com.mobilebytelabs.paycraft.sample

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.sample.BillingStateDebugPanel
import com.mobilebytelabs.paycraft.ui.PayCraftBanner
import com.mobilebytelabs.paycraft.ui.PayCraftSheet

/**
 * PayCraft Sample App
 *
 * Demonstrates PayCraft billing integration:
 * - PayCraftBanner in a settings-like screen — upgrade, manage and restore are all handled
 *   inside the SDK, so the banner takes nothing but a modifier
 * - PayCraftSheet (bottom sheet paywall), for a host that raises the paywall from its OWN button
 *
 * Configure PayCraft in SampleApplication.kt (Android) or platform-specific
 * entry points before calling App().
 */
@Composable
fun App() {
    MaterialTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            SampleScreen()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SampleScreen() {
    var showPaywall by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("PayCraft Sample") })
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Settings",
                style = MaterialTheme.typography.headlineSmall,
            )

            // PayCraftBanner — upgrade CTA or active premium status. No callbacks: tapping
            // upgrade raises the SDK's paywall, manage opens the store/provider page, and restore
            // opens the SDK's restore sheet, all without this screen holding any state for them.
            PayCraftBanner(modifier = Modifier.fillMaxWidth())

            // Debug panel — displays BillingState with testTag assertions
            BillingStateDebugPanel(modifier = Modifier.fillMaxWidth())

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Manual Controls",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Button(
                onClick = { showPaywall = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open Paywall")
            }

            // No manual "Restore Purchase" button any more: PayCraftRestore is internal, because a
            // host placing the sheet itself is exactly the wiring the banner above removes. Restore
            // is reached from the banner's own link, or from PayCraftSubscriptionSettings.
        }
    }

    // PayCraftSheet — bottom sheet paywall
    PayCraftSheet(
        visible = showPaywall,
        onDismiss = { showPaywall = false },
    )
}
