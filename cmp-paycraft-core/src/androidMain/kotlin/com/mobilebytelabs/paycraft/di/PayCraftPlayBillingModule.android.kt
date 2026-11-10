package com.mobilebytelabs.paycraft.di

import android.app.Activity
import android.content.Context
import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.PlayBillingNativeClient
import org.koin.core.module.Module
import org.koin.dsl.module

/**
 * Android-side Koin override that swaps the default `WebCheckoutNativeBillingClient`
 * (bound in `PayCraftModule`) for the real Play Billing v8 [PlayBillingNativeClient].
 *
 * Consumers load it AFTER [com.mobilebytelabs.paycraft.di.PayCraftModule]:
 *
 * ```kotlin
 * startKoin {
 *     modules(
 *         PayCraftModule,
 *         paycraftPlayBillingModule(
 *             context = applicationContext,
 *             activityProvider = { currentResumedActivity() },
 *         ),
 *     )
 * }
 * ```
 *
 * @param context application context for the [android.content.Context]-backed BillingClient.
 * @param activityProvider supplies the foreground [Activity] `launchBillingFlow` requires.
 */
fun paycraftPlayBillingModule(context: Context, activityProvider: () -> Activity?): Module = module {
    single<NativeBillingClient> {
        PlayBillingNativeClient(
            context = context,
            activityProvider = activityProvider,
        )
    }
}
