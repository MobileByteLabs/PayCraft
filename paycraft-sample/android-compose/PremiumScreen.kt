package com.example.paycraftdemo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.ui.PayCraftPaywall
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

@Composable
fun PremiumScreen(onDismiss: () -> Unit, billingManager: BillingManager = koinInject()) {
    val isPremium by billingManager.isPremium.collectAsState()
    val scope = rememberCoroutineScope()

    if (isPremium) {
        // Premium content
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Welcome, premium user!", style = MaterialTheme.typography.headlineMedium)

            Button(
                onClick = { scope.launch { billingManager.refreshStatus(force = true) } },
                modifier = Modifier.padding(top = 16.dp),
            ) {
                Text("Refresh Status")
            }
        }
    } else {
        // Show paywall
        PayCraftPaywall(onDismiss = onDismiss)
    }
}
