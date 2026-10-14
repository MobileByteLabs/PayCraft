package com.mobilebytelabs.paycraft

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The store-manage destination, per platform.
 *
 * Regression for the defect this fallback exists to fix: `provider.getManageUrl` returns null for
 * every native store, so `manageSubscription` was a NO-OP for a store-billed subscriber — the
 * Manage-subscription button did nothing. The first host to notice filled the gap itself and
 * hardcoded the Google Play URL for ALL platforms, so an iPhone subscriber was sent to a page that
 * cannot show their subscription, from the one screen whose job is cancelling it.
 */
class StoreSubscriptionsUrlTest {

    @Test
    fun androidGoesToPlay() {
        assertEquals(
            "https://play.google.com/store/account/subscriptions",
            storeSubscriptionsUrlFor("android"),
        )
    }

    @Test
    fun iosGoesToApple_notPlay() {
        // The actual bug: this used to be the Play URL.
        assertEquals(
            "https://apps.apple.com/account/subscriptions",
            storeSubscriptionsUrlFor("ios"),
        )
    }

    @Test
    fun macosSharesTheAppleAccountPage() {
        assertEquals(
            "https://apps.apple.com/account/subscriptions",
            storeSubscriptionsUrlFor("macos"),
        )
    }

    @Test
    fun platformStringIsCaseInsensitive() {
        // PlatformInfo.platform is not contractually lower-case; matching exactly would silently
        // fall through to null on a platform that capitalises.
        assertEquals(storeSubscriptionsUrlFor("ios"), storeSubscriptionsUrlFor("iOS"))
        assertEquals(storeSubscriptionsUrlFor("android"), storeSubscriptionsUrlFor("Android"))
    }

    @Test
    fun platformsWithNoStorePageReturnNull() {
        // Honest "nowhere to send them" — the caller hides the affordance rather than opening a
        // page that cannot help. Guessing a store here is how the original defect happened.
        assertNull(storeSubscriptionsUrlFor("jvm"))
        assertNull(storeSubscriptionsUrlFor("desktop"))
        assertNull(storeSubscriptionsUrlFor("web"))
        assertNull(storeSubscriptionsUrlFor(""))
    }
}
