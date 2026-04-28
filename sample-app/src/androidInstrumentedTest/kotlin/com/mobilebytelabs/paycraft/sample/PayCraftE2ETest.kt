package com.mobilebytelabs.paycraft.sample

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.mobilebytelabs.paycraft.network.OtpGateResult
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import org.junit.Assert.assertEquals
import org.junit.Test

class PayCraftE2ETest : BasePayCraftUiTest() {

    // ─── P1: Free gate (no subscription) ────────────────────────────────────

    @Test
    fun p1_freeGate_noSubscription() {
        launchApp()
        assertBillingState("Free")
    }

    // ─── P2: Restore/purchase flow ──────────────────────────────────────────

    @Test
    fun p2_restorePurchase() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_test_p2",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Free")
        loginWith("user@test.com")
        assertBillingState("Premium")
        assertTextWithTag("billing_plan", "monthly")
        assertTextWithTag("billing_will_renew", "true")
        assertEquals(1, fakeService.registerDeviceCallCount)
    }

    // ─── P3: Cached restore (fast path) ─────────────────────────────────────

    @Test
    fun p3_cachedRestore() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_cached_p3")
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        // Init block reads email + token -> checkPremiumWithDevice -> Premium (no user action)
        assertBillingState("Premium")
        assertEquals(0, fakeService.registerDeviceCallCount) // fast path: no register
        assertEquals(1, fakeService.checkPremiumCallCount)
    }

    // ─── P4: Clear data restore ─────────────────────────────────────────────

    @Test
    fun p4_clearDataRestore() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_new_p4",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        assertBillingState("Free")
        loginWith("user@test.com")
        assertBillingState("Premium")
    }

    // ─── P5: Reinstall restore (same device_id, no conflict) ────────────────

    @Test
    fun p5_reinstallRestore() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_same_token_p5",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        loginWith("user@test.com")
        assertBillingState("Premium")
        assertEquals(1, fakeService.registerDeviceCallCount)
    }

    // ─── P6: Conflict + OTP verification ────────────────────────────────────

    @Test
    fun p6_conflictWithOtp() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_pending_p6",
            conflict = true,
            conflictingDeviceName = "Google Pixel 9 Pro",
            conflictingLastSeen = "2026-04-27T10:00:00Z",
        )
        fakeService.otpGateResponse = OtpGateResult(available = true, sendsToday = 1, limit = 300)
        fakeService.verifyOtpResponse = true
        fakeService.transferResponse = true
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        loginWith("user@test.com")
        assertBillingState("DeviceConflict")
        assertTextWithTag("billing_conflict_device", "Google Pixel 9 Pro")
        assertTextWithTag("billing_otp_available", "true")

        // Enter OTP and verify
        composeTestRule.onNodeWithTag("input_otp").performTextInput("123456")
        composeTestRule.onNodeWithTag("btn_verify_otp").performClick()
        assertBillingState("OwnershipVerified")
        assertTextWithTag("billing_verified_via", "OTP")

        // Confirm transfer
        composeTestRule.onNodeWithTag("btn_confirm_transfer").performClick()
        assertBillingState("Premium")
        assertEquals(1, fakeService.transferCallCount)
    }

    // ─── P7: Conflict + Google OAuth ────────────────────────────────────────

    @Test
    fun p7_conflictWithOAuth() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_pending_p7",
            conflict = true,
            conflictingDeviceName = "Samsung Galaxy S25",
            conflictingLastSeen = "2026-04-27T10:00:00Z",
        )
        fakeService.otpGateResponse = OtpGateResult(available = true, sendsToday = 0, limit = 300)
        fakeService.verifyOAuthResponse = "user@test.com"
        fakeService.transferResponse = true
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        loginWith("user@test.com")
        assertBillingState("DeviceConflict")

        // Trigger OAuth
        composeTestRule.onNodeWithTag("btn_login_oauth").performClick()
        assertBillingState("OwnershipVerified")
        assertTextWithTag("billing_verified_via", "OAUTH")

        // Confirm transfer
        composeTestRule.onNodeWithTag("btn_confirm_transfer").performClick()
        assertBillingState("Premium")
    }

    // ─── P8: Transfer accepted ──────────────────────────────────────────────

    @Test
    fun p8_transferAccepted() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_pending_p8",
            conflict = true,
            conflictingDeviceName = "iPhone 16 Pro",
            conflictingLastSeen = "2026-04-27T10:00:00Z",
        )
        fakeService.otpGateResponse = OtpGateResult(available = true, sendsToday = 0, limit = 300)
        fakeService.verifyOAuthResponse = "user@test.com"
        fakeService.transferResponse = true
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        loginWith("user@test.com")
        assertBillingState("DeviceConflict")
        composeTestRule.onNodeWithTag("btn_login_oauth").performClick()
        assertBillingState("OwnershipVerified")

        // Confirm transfer
        composeTestRule.onNodeWithTag("btn_confirm_transfer").performClick()
        assertBillingState("Premium")
        assertEquals(1, fakeService.transferCallCount)
    }

    // ─── P9: Expired subscription ───────────────────────────────────────────

    @Test
    fun p9_expiredSubscription() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_expired_p9",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = false, tokenValid = true)

        launchApp()
        loginWith("user@test.com")
        // Token valid but subscription expired -> Free
        assertBillingState("Free")
    }

    // ─── P10: Revoked token (re-registers automatically) ────────────────────

    @Test
    fun p10_revokedToken() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_revoked_p10")

        // First call: token invalid -> triggers re-registration
        // Second call (after re-register): premium
        fakeService.checkPremiumResponses = mutableListOf(
            PremiumCheckResult(isPremium = false, tokenValid = false), // 1st: revoked
            PremiumCheckResult(isPremium = true, tokenValid = true), // 2nd: after re-register
        )
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_new_p10",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "monthly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        // Init: email found -> checkPremium (tokenValid=false) -> re-register -> checkPremium -> Premium
        assertBillingState("Premium")
        assertEquals(1, fakeService.registerDeviceCallCount)
        assertEquals(2, fakeService.checkPremiumCallCount)
    }

    // ─── P11: Cancelled-in-period (still premium, willRenew=false) ──────────

    @Test
    fun p11_cancelledInPeriod() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_cancelled_p11",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = true, // cancelled but period not ended
        )

        launchApp()
        loginWith("user@test.com")
        assertBillingState("Premium")
        // willRenew = !cancelAtPeriodEnd = false
        assertTextWithTag("billing_will_renew", "false")
        assertTextWithTag("billing_expires_at", "2027-04-26T00:00:00Z")
    }

    // ─── P12: OTP rate limit (gate blocked) ─────────────────────────────────

    @Test
    fun p12_otpRateLimit() {
        fakeService.registerDeviceResponse = RegisterDeviceResult(
            deviceToken = "srv_ratelimit_p12",
            conflict = true,
            conflictingDeviceName = "iPhone 16 Pro",
            conflictingLastSeen = "2026-04-27T10:00:00Z",
        )
        fakeService.otpGateResponse = OtpGateResult(available = false, sendsToday = 300, limit = 300)

        launchApp()
        loginWith("user@test.com")
        assertBillingState("DeviceConflict")
        assertTextWithTag("billing_otp_available", "false")
    }

    // ─── P13: device_id backfill (no re-register needed) ────────────────────

    @Test
    fun p13_deviceIdBackfill() {
        fakeStore.seedEmail("user@test.com")
        DeviceTokenStore.saveToken("srv_backfill_p13")
        fakeService.checkPremiumResponse = PremiumCheckResult(isPremium = true, tokenValid = true)
        fakeService.subscriptionResponse = SubscriptionDto(
            email = "user@test.com",
            plan = "yearly",
            status = "active",
            currentPeriodEnd = "2027-04-26T00:00:00Z",
            cancelAtPeriodEnd = false,
        )

        launchApp()
        // Fast path: email + token cached -> checkPremiumWithDevice only -> Premium
        assertBillingState("Premium")
        assertEquals(0, fakeService.registerDeviceCallCount)
        assertEquals(1, fakeService.checkPremiumCallCount)
    }
}
