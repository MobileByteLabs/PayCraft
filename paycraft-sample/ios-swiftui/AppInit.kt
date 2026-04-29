// shared/src/iosMain/kotlin/com/example/paycraftdemo/AppInit.kt
package com.example.paycraftdemo

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.stripe.StripeProvider

fun initPayCraft() {
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
}
