package com.mobilebytelabs.paycraft.platform

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager

actual object PlatformInfo {
    actual val platform: String = "android"
    actual val deviceName: String
        get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    actual val deviceId: String
        get() = DeviceTokenStore.applicationContext?.let { ctx ->
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } ?: "android-unknown"

    // Billing region follows the SIM/network country (the signal Google Play itself uses),
    // NOT the language locale — a user whose phone language is English (UK) but whose SIM is
    // Indian must bill in ₹, not £. Falls back to the language-locale region only when there's
    // no SIM/network (e.g. a wifi-only tablet). simCountryIso/networkCountryIso are permission-free.
    actual val country: String?
        get() = simOrNetworkCountry()
            ?: java.util.Locale.getDefault().country.takeIf { it.isNotBlank() }
}

private fun simOrNetworkCountry(): String? {
    val ctx = DeviceTokenStore.applicationContext ?: return null
    val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return null
    // SIM country is most authoritative for billing; network country covers roaming/eSIM gaps.
    return (tm.simCountryIso?.takeIf { it.isNotBlank() } ?: tm.networkCountryIso?.takeIf { it.isNotBlank() })
        ?.uppercase()
}
