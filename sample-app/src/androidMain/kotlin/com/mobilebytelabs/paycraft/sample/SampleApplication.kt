package com.mobilebytelabs.paycraft.sample

import android.app.Application
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.di.PayCraftModule
import com.mobilebytelabs.paycraft.model.BillingBenefit
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
            benefits(
                BillingBenefit(icon = Icons.Default.Block, text = "Ad-free experience"),
                BillingBenefit(icon = Icons.Default.Download, text = "Unlimited downloads"),
                BillingBenefit(icon = Icons.Default.Star, text = "Premium features"),
                BillingBenefit(icon = Icons.Default.Speed, text = "Faster performance"),
            )
            supportEmail("support@yourdomain.com") // replace
        }

        // Step 2: Initialize Koin with PayCraftModule
        startKoin {
            androidContext(this@SampleApplication)
            modules(PayCraftModule)
        }
    }
}
