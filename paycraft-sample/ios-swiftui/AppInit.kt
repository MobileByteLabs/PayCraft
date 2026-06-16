// shared/src/iosMain/kotlin/com/example/paycraftdemo/AppInit.kt
package com.example.paycraftdemo

import com.mobilebytelabs.paycraft.PayCraft

fun initPayCraft() {
    // Single-line cloud configuration — products, providers, pricing, and paywall
    // all live in your PayCraft dashboard at https://paycraft.cloud.
    PayCraft.initialize(apiKey = "pk_live_REPLACE_WITH_YOUR_KEY")
}
