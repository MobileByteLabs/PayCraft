package com.mobilebytelabs.paycraft

import android.content.Intent
import android.net.Uri
import co.touchlab.kermit.Logger
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore

actual object PayCraftPlatform {
    private var appContext: android.content.Context? = null

    fun init(context: android.content.Context) {
        appContext = context.applicationContext
        DeviceTokenStore.init(context.applicationContext)
    }

    actual fun openUrl(url: String) {
        val context = appContext ?: run {
            Logger.e("PayCraftPlatform") {
                "Android context not initialized. Call PayCraftPlatform.init(context) first."
            }
            return
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
