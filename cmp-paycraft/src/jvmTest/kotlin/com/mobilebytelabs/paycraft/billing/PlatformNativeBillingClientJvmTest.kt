package com.mobilebytelabs.paycraft.billing

import kotlin.test.Test
import kotlin.test.assertNull

/**
 * On a web/desktop platform there is no native app store, so the platform
 * default is null and PayCraftModule falls back to WebCheckoutNativeBillingClient.
 * (The Android actual returns the real PlayBillingNativeClient — verified by the
 * device/integration build, not a JVM unit test since it needs a Context.)
 */
class PlatformNativeBillingClientJvmTest {
    @Test
    fun jvm_has_no_native_store_falls_back_to_web_checkout() {
        assertNull(platformDefaultNativeBillingClient())
    }
}
