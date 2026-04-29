package com.example.paycraftdemo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ComposeViewport
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.stripe.StripeProvider
import com.mobilebytelabs.paycraft.ui.PayCraftPaywall
import kotlinx.browser.document
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    PayCraft.configure {
        supabase(
            url = "https://your-project.supabase.co",
            anonKey = "your-anon-key",
        )
        provider(
            StripeProvider(
                paymentLinks = mapOf(
                    "monthly" to "https://buy.stripe.com/your-monthly-link",
                    "yearly" to "https://buy.stripe.com/your-yearly-link",
                ),
            ),
        )
        plans(
            BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"),
            BillingPlan(id = "yearly", name = "Yearly", price = "$39.99/yr"),
        )
        supportEmail("support@yourapp.com")
    }

    ComposeViewport(document.body!!) {
        MaterialTheme {
            PremiumContent()
        }
    }
}

@Composable
fun PremiumContent(billingManager: BillingManager = koinInject()) {
    val isPremium by billingManager.isPremium.collectAsState()
    val scope = rememberCoroutineScope()

    if (isPremium) {
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
        PayCraftPaywall(onDismiss = {})
    }
}
