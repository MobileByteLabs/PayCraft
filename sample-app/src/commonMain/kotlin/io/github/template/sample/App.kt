package com.mobilebytelabs.paycraft.sample

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.mobilebytelabs.paycraft.ui.PayCraftRestore
import com.mobilebytelabs.paycraft.ui.PayCraftSheet

/**
 * PayCraft Sample App
 *
 * Demonstrates PayCraft billing integration:
 * - PayCraftBanner in a settings-like screen
 * - PayCraftSheet (bottom sheet paywall)
 * - PayCraftRestore (email-based restore purchase)
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
    var showRestore by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("PayCraft Sample") })
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Settings",
                style = MaterialTheme.typography.headlineSmall,
            )

            // PayCraftBanner — shows upgrade CTA or active premium status
            PayCraftBanner(
                onUpgradeClick = { showPaywall = true },
                onManageClick = { showPaywall = true },
                onRestoreClick = { showRestore = true },
                modifier = Modifier.fillMaxWidth(),
            )

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

            OutlinedButton(
                onClick = { showRestore = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Restore Purchase")
            }
        }
    }

    // PayCraftSheet — bottom sheet paywall
    PayCraftSheet(
        visible = showPaywall,
        onDismiss = { showPaywall = false },
    )

    // PayCraftRestore — email-based restore
    PayCraftRestore(
        visible = showRestore,
        onDismiss = { showRestore = false },
    )
}
