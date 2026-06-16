package com.mobilebytelabs.paycraftsample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.mobilebytelabs.paycraft.PayCraft

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Get your API key at https://paycraft.cloud → onboarding → API keys
        PayCraft.initialize(apiKey = "pk_live_REPLACE_ME")
        setContent { App() }
    }
}
