package com.mobilebytelabs.paycraft.sample

import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.mobilebytelabs.paycraft.core.SyncPolicy
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PayCraftSmartSyncE2ETest : BasePayCraftUiTest() {

    // ─── S1: Cached premium shows immediately (no network call) ─────────────

    @Test
    fun s1_cachedPremium_showsImmediately_noNetworkCall() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cached_s1")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "yearly",
                email = "user@test.com",
                provider = "stripe",
                expiresAt = futureIso(days = 30),
                willRenew = true,
            ),
            syncedAt = currentTimeMillis(), // just synced — cache is fresh
        )

        launchApp()

        // Cache-first init: Premium shown instantly from cache
        assertBillingState("Premium")
        assertTextWithTag("billing_plan", "yearly")
        assertTextWithTag("billing_will_renew", "true")

        // Fresh cache → no Supabase call
        assertEquals(0, fakeService.checkPremiumCallCount)
        assertEquals(0, fakeService.registerDeviceCallCount)
    }

    // ─── S2: Stale cache → background sync updates ─────────────────────────

    @Test
    fun s2_staleCache_backgroundSyncUpdates() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cached_s2")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                provider = "stripe",
                expiresAt = futureIso(days = 30),
                willRenew = true,
            ),
            syncedAt = currentTimeMillis() - SyncPolicy.ONE_WEEK - 1000, // stale (>1 week old)
        )

        // Server says premium with updated plan
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly", // plan changed on server
            status = "active",
            currentPeriodEnd = futureIso(days = 365),
            cancelAtPeriodEnd = false,
        )

        launchApp()

        // Premium shown immediately from cache
        assertBillingState("Premium")

        // Wait for background sync to update plan
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("billing_plan")
                .fetchSemanticsNodes()
                .any { node -> node.config.any { it.value == "yearly" } }
        }
        assertTextWithTag("billing_plan", "yearly")

        // Stale cache triggered a sync
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S3: Cached free + sync discovers premium ──────────────────────────

    @Test
    fun s3_cachedFree_syncDiscoversPremium() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cached_s3")
        fakeStore.seedCache(
            SubscriptionStatus(isPremium = false, email = "user@test.com"),
            syncedAt = currentTimeMillis() - SyncPolicy.ONE_DAY - 1000, // stale (>1 day for free)
        )

        // Server says now premium (user purchased externally)
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = futureIso(days = 30),
            cancelAtPeriodEnd = false,
        )

        launchApp()

        // Cache shows Free initially, then sync discovers Premium
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("billing_state_label")
                .fetchSemanticsNodes()
                .any { node -> node.config.any { it.value == "Premium" } }
        }
        assertBillingState("Premium")
        assertTextWithTag("billing_plan", "monthly")
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S4: Premium cache + sync discovers expired → Free ─────────────────

    @Test
    fun s4_premiumCache_syncFindsExpired_transitionsToFree() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cached_s4")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                expiresAt = futureIso(hours = 6), // expires soon → hourly sync
                willRenew = false,
            ),
            syncedAt = currentTimeMillis() - SyncPolicy.ONE_HOUR - 1000, // stale for hourly
        )

        // Server says no longer premium (subscription expired)
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = false, tokenValid = true)

        launchApp()

        // Cache shows Premium first, then sync discovers expired → Free
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("billing_state_label")
                .fetchSemanticsNodes()
                .any { node -> node.config.any { it.value == "Free" } }
        }
        assertBillingState("Free")
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S5: No cache → fetches from Supabase (existing behavior) ──────────

    @Test
    fun s5_noCache_fetchesFromSupabase() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_nocache_s5")
        // No seedCache → cache miss

        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = futureIso(days = 365),
            cancelAtPeriodEnd = false,
        )

        launchApp()

        // No cache → must fetch from Supabase
        assertBillingState("Premium")
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S6: Logout clears cache → shows Free ─────────────────────────────

    @Test
    fun s6_logout_clearsCacheAndShowsFree() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_logout_s6")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                expiresAt = futureIso(days = 30),
                willRenew = true,
            ),
            syncedAt = currentTimeMillis(),
        )

        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = futureIso(days = 30),
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Premium")

        // Logout
        composeTestRule.onNodeWithTag("btn_logout").performClick()
        assertBillingState("Free")

        // Verify cache was cleared
        assertNull(fakeStore.getCachedSubscriptionStatus())
        assertEquals(0L, fakeStore.getLastSyncedAt())
    }

    // ─── S7: Refresh always fetches (bypasses cache) ───────────────────────

    @Test
    fun s7_refreshAlwaysFetches() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_refresh_s7")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                expiresAt = futureIso(days = 30),
                willRenew = true,
            ),
            syncedAt = currentTimeMillis(), // fresh cache
        )

        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly", // changed on server
            status = "active",
            currentPeriodEnd = futureIso(days = 365),
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Premium")
        assertTextWithTag("billing_plan", "monthly") // from cache
        assertEquals(0, fakeService.checkPremiumCallCount) // fresh → no sync

        // User triggers refresh — always fetches regardless of cache freshness
        composeTestRule.onNodeWithTag("btn_refresh").performClick()

        composeTestRule.waitUntil(timeoutMillis = 5000) {
            composeTestRule.onAllNodesWithTag("billing_plan")
                .fetchSemanticsNodes()
                .any { node -> node.config.any { it.value == "yearly" } }
        }
        assertTextWithTag("billing_plan", "yearly")
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S8: Login always fetches (new login, no cache reliance) ───────────

    @Test
    fun s8_loginAlwaysFetches() {
        // Stale premium cache from a previous user
        fakeStore.seedCache(
            SubscriptionStatus(isPremium = true, plan = "yearly", email = "old@test.com"),
            syncedAt = currentTimeMillis(),
        )

        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_login_s8",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = false, tokenValid = true)

        launchApp()
        // No email seeded → init shows Free (cache has email mismatch, no saved email)

        // Login with new user → always fetches fresh from Supabase
        loginWith("newuser@test.com")

        assertBillingState("Free") // server says not premium
        assertEquals(1, fakeService.registerDeviceCallCount)
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S9: Cache survives app relaunch (simulated via new BillingManager) ─

    @Test
    fun s9_cacheWrittenAfterSync_persistsForNextLaunch() {
        // First "launch": no cache, fetches from Supabase
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_persist_s9")
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "quarterly",
            status = "active",
            currentPeriodEnd = futureIso(days = 90),
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Premium")
        assertEquals(1, fakeService.checkPremiumCallCount)

        // Verify cache was written by applyPremiumResult
        val cached = fakeStore.getCachedSubscriptionStatus()
        assertEquals(true, cached?.isPremium)
        assertEquals("quarterly", cached?.plan)
        assertEquals(true, cached?.willRenew)
    }

    // ─── S10: Cancelled subscription → daily sync interval ─────────────────

    @Test
    fun s10_cancelledSubscription_syncsDaily() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cancelled_s10")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                expiresAt = futureIso(days = 15),
                willRenew = false, // cancelled
            ),
            // Synced 25 hours ago — daily interval applies for cancelled
            syncedAt = currentTimeMillis() - SyncPolicy.ONE_DAY - SyncPolicy.ONE_HOUR,
        )

        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = futureIso(days = 15),
            cancelAtPeriodEnd = true,
        )

        launchApp()
        assertBillingState("Premium")

        // Cancelled + >1 day since sync → triggered background sync
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            fakeService.checkPremiumCallCount >= 1
        }
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── S11: Near-expiry → hourly sync catches renewal ────────────────────

    @Test
    fun s11_nearExpiry_syncsHourly() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_nearexpiry_s11")
        fakeStore.seedCache(
            SubscriptionStatus(
                isPremium = true,
                plan = "monthly",
                email = "user@test.com",
                expiresAt = futureIso(hours = 12), // expires in 12h → hourly sync
                willRenew = true,
            ),
            // Synced 2 hours ago — hourly interval triggers sync
            syncedAt = currentTimeMillis() - 2 * SyncPolicy.ONE_HOUR,
        )

        // Server confirms renewed with extended expiry
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = futureIso(days = 30), // renewed!
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Premium")

        // Near expiry + >1 hour since sync → triggered background sync
        composeTestRule.waitUntil(timeoutMillis = 5000) {
            fakeService.checkPremiumCallCount >= 1
        }
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private fun futureIso(days: Int = 0, hours: Int = 0): String {
        val futureMs = currentTimeMillis() + days * SyncPolicy.ONE_DAY + hours * SyncPolicy.ONE_HOUR
        return millisToIso(futureMs)
    }

    private fun millisToIso(millis: Long): String {
        val totalSeconds = millis / 1000
        val second = (totalSeconds % 60).toInt()
        val totalMinutes = totalSeconds / 60
        val minute = (totalMinutes % 60).toInt()
        val totalHours = totalMinutes / 60
        val hour = (totalHours % 24).toInt()
        var remainingDays = (totalHours / 24).toInt()

        var year = 1970
        while (true) {
            val daysInYear = if (isLeapYear(year)) 366 else 365
            if (remainingDays < daysInYear) break
            remainingDays -= daysInYear
            year++
        }

        val monthDays = intArrayOf(31, if (isLeapYear(year)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        var month = 0
        while (month < 12 && remainingDays >= monthDays[month]) {
            remainingDays -= monthDays[month]
            month++
        }
        val day = remainingDays + 1
        month += 1

        return "${year.pad(4)}-${month.pad(2)}-${day.pad(2)}T${hour.pad(2)}:${minute.pad(2)}:${second.pad(2)}Z"
    }

    private fun Int.pad(len: Int): String = this.toString().padStart(len, '0')

    private fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
