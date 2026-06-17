package com.example.paycraftdemo

import android.app.Application
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.di.PayCraftModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class MyApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Single-line cloud configuration — products, providers, pricing, and paywall
        // all live in your PayCraft dashboard at https://paycraft.mobilebytesensei.com.
        PayCraft.initialize(apiKey = "pk_live_REPLACE_WITH_YOUR_KEY")

        startKoin {
            androidContext(this@MyApp)
            modules(PayCraftModule)
        }
    }
}
