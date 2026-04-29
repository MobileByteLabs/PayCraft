package com.example.paycraftdemo

import android.app.Application
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftPlatform
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.stripe.StripeProvider
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class MyApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Required for EncryptedSharedPreferences on Android
        PayCraftPlatform.init(this)

        // Configure PayCraft
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

        // Register Koin module
        startKoin {
            androidContext(this@MyApp)
            modules(PayCraftModule)
        }
    }
}
