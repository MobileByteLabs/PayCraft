package com.mobilebytelabs.paycraftsample

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import com.mobilebytelabs.paycraft.PayCraftPaywall

@Composable
fun App() {
    MaterialTheme {
        PayCraftPaywall()
    }
}
