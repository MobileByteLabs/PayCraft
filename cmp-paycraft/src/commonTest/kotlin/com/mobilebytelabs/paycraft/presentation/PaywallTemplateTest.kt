package com.mobilebytelabs.paycraft.presentation

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.TrialInfo
import com.mobilebytelabs.paycraft.model.VerificationMethod
import kotlin.test.Test

/**
 * AC-5 verifier — exercises all 3 [PaywallTemplate] × 6 [BillingState] cases for a
 * total of 18 distinct rendering paths. Each test renders the template with the
 * given state and asserts a UI marker text uniquely produced by that state branch.
 *
 * Uses Compose Multiplatform's [runComposeUiTest] (commonTest-friendly) instead of
 * JUnit + createComposeRule so the same suite runs against any target.
 */
@OptIn(ExperimentalTestApi::class)
class PaywallTemplateTest {

    private val sampleProducts = listOf(
        Product.Subscription(
            id = "p1",
            sku = "monthly",
            displayName = "Monthly",
            displayOrder = 0,
            interval = Product.Subscription.Interval.MONTH,
            basePrice = Money(999, "USD"),
        ),
        Product.Trial(
            id = "p2",
            sku = "trial",
            displayName = "7-day Free Trial",
            displayOrder = 1,
            durationDays = 7,
            attachesToProductId = "p1",
        ),
        Product.Lifetime(
            id = "p3",
            sku = "lifetime",
            displayName = "Lifetime",
            displayOrder = 2,
            basePrice = Money(4999, "USD"),
        ),
    )

    private val premiumState = BillingState.Premium(
        status = SubscriptionStatus(isPremium = true, plan = "monthly", expiresAt = "2027-01-01"),
        trial = TrialInfo(endsAt = "2027-01-08", daysRemaining = 5),
    )

    private val conflictState = BillingState.DeviceConflict(
        email = "user@example.com",
        pendingToken = "tok",
        conflictingDeviceName = "iPhone 14",
        conflictingLastSeen = "2026-06-01",
        otpAvailable = true,
        otpDailyLimit = 5,
        supportEmail = "support@example.com",
    )

    private val verifiedState = BillingState.OwnershipVerified(
        email = "user@example.com",
        pendingToken = "tok",
        conflictingDeviceName = "iPhone 14",
        conflictingLastSeen = "2026-06-01",
        verifiedVia = VerificationMethod.OAUTH,
        supportEmail = "support@example.com",
    )

    // MINIMAL — 6 states

    @Test fun minimal_loading() = renderAndAssert(PaywallTemplate.MINIMAL, BillingState.Loading, "Loading")

    @Test fun minimal_free() = renderAndAssert(PaywallTemplate.MINIMAL, BillingState.Free, "Upgrade to Premium")

    @Test fun minimal_premium() = renderAndAssert(PaywallTemplate.MINIMAL, premiumState, "You're Premium")

    @Test fun minimal_error() = renderAndAssert(PaywallTemplate.MINIMAL, BillingState.Error("network"), "Retry")

    @Test fun minimal_device_conflict() = renderAndAssert(
        PaywallTemplate.MINIMAL,
        conflictState,
        "bound to another device",
    )

    @Test fun minimal_ownership_verified() = renderAndAssert(PaywallTemplate.MINIMAL, verifiedState, "Verified via")

    // PREMIUM — 6 states

    @Test fun premium_loading() = renderAndAssert(PaywallTemplate.PREMIUM, BillingState.Loading, "Loading")

    @Test fun premium_free() = renderAndAssert(PaywallTemplate.PREMIUM, BillingState.Free, "Upgrade to Premium")

    @Test fun premium_premium() = renderAndAssert(PaywallTemplate.PREMIUM, premiumState, "You're Premium")

    @Test fun premium_error() = renderAndAssert(
        PaywallTemplate.PREMIUM,
        BillingState.Error("server unavailable"),
        "Retry",
    )

    @Test fun premium_device_conflict() = renderAndAssert(
        PaywallTemplate.PREMIUM,
        conflictState,
        "bound to another device",
    )

    @Test fun premium_ownership_verified() = renderAndAssert(PaywallTemplate.PREMIUM, verifiedState, "Verified via")

    // DARK — 6 states

    @Test fun dark_loading() = renderAndAssert(PaywallTemplate.DARK, BillingState.Loading, "Loading")

    @Test fun dark_free() = renderAndAssert(PaywallTemplate.DARK, BillingState.Free, "Upgrade to Premium")

    @Test fun dark_premium() = renderAndAssert(PaywallTemplate.DARK, premiumState, "You're Premium")

    @Test fun dark_error() = renderAndAssert(PaywallTemplate.DARK, BillingState.Error("offline"), "Retry")

    @Test fun dark_device_conflict() = renderAndAssert(PaywallTemplate.DARK, conflictState, "bound to another device")

    @Test fun dark_ownership_verified() = renderAndAssert(PaywallTemplate.DARK, verifiedState, "Verified via")

    private fun renderAndAssert(template: PaywallTemplate, state: BillingState, markerText: String) {
        runComposeUiTest {
            setContent {
                template.render(
                    state = state,
                    products = sampleProducts,
                    onPickProduct = {},
                    onRetry = {},
                )
            }
            onNodeWithText(markerText, substring = true).assertExists()
        }
    }
}
