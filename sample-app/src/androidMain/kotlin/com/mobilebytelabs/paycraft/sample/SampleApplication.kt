package com.mobilebytelabs.paycraft.sample

import android.app.Application
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.StripeProvider
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

/**
 * PayCraft Sample Application
 *
 * Replace the placeholder values below with your real configuration.
 * Run /setup in the PayCraft repo to generate these values automatically.
 */
class SampleApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Step 1: Configure PayCraft BEFORE Koin
        // Replace with your real values from /setup output
        PayCraft.configure {
            supabase(
                url = "https://YOUR_PROJECT_REF.supabase.co", // replace
                anonKey = "YOUR_SUPABASE_ANON_KEY", // replace
            )
            provider(
                StripeProvider(
                    paymentLinks = mapOf(
                        "monthly" to "https://buy.stripe.com/YOUR_MONTHLY", // replace
                        "quarterly" to "https://buy.stripe.com/YOUR_QUARTERLY", // replace
                        "yearly" to "https://buy.stripe.com/YOUR_YEARLY", // replace
                    ),
                    customerPortalUrl = "https://billing.stripe.com/p/login/YOUR_PORTAL", // replace
                ),
            )
            plans(
                BillingPlan(id = "monthly", name = "Monthly", price = "₹99", interval = "/month", rank = 1),
                BillingPlan(id = "quarterly", name = "Quarterly", price = "₹249", interval = "/3 months", rank = 2),
                BillingPlan(
                    id = "yearly",
                    name = "Yearly",
                    price = "₹799",
                    interval = "/year",
                    rank = 3,
                    isPopular = true,
                ),
            )
            // benefits() requires StringResource — configure with actual resources in real app
            supportEmail("support@yourdomain.com") // replace
        }

        // Step 2: Initialize Koin with PayCraftModule
        startKoin {
            androidContext(this@SampleApplication)
            modules(PayCraftModule)
        }
    }
}
