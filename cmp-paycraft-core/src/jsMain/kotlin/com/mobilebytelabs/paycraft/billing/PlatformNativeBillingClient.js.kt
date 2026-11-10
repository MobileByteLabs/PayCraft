package com.mobilebytelabs.paycraft.billing

/** Browser/JS has no native app store — the caller uses web checkout. */
actual fun platformDefaultNativeBillingClient(): NativeBillingClient? = null
