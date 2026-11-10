package com.mobilebytelabs.paycraft.billing

/** Desktop/JVM has no native app store — the caller uses web checkout. */
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? = null
