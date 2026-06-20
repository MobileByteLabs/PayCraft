package com.mobilebytelabs.paycraft.presentation

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.config.ValuePropTriple
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

    // BRANDED_STACK — 6 billing states (AC-5 parity with legacy templates)

    /**
     * BrandedStackLoading renders a "Loading subscription status…" text node and a
     * circular progress indicator. The marker "Loading" is unique to this state branch.
     */
    @Test fun branded_stack_loading() = renderAndAssert(PaywallTemplate.BRANDED_STACK, BillingState.Loading, "Loading")

    /**
     * BrandedStackFree uses the default [PaywallDto.heroTitle] ("Upgrade to Premium")
     * when no [LocalPayCraftConfig] is provided — the `?: PaywallDto()` fallback in
     * [paywallConfig] guarantees the default fires in the test harness.
     */
    @Test fun branded_stack_free() = renderAndAssert(
        PaywallTemplate.BRANDED_STACK,
        BillingState.Free,
        "Upgrade to Premium",
    )

    @Test fun branded_stack_premium() = renderAndAssert(PaywallTemplate.BRANDED_STACK, premiumState, "You're Premium")

    @Test fun branded_stack_error() = renderAndAssert(
        PaywallTemplate.BRANDED_STACK,
        BillingState.Error("network"),
        "Retry",
    )

    /**
     * BrandedStackDeviceConflict renders "Device limit reached" — distinct from the
     * legacy templates which render "bound to another device". Asserting the
     * BrandedStack-specific heading string guards against accidental template bleed.
     */
    @Test fun branded_stack_device_conflict() =
        renderAndAssert(PaywallTemplate.BRANDED_STACK, conflictState, "Device limit reached")

    /**
     * BrandedStackOwnershipVerified renders a "Verified" heading and "Your subscription
     * is now active on this device." body — no "via" suffix in this template.
     */
    @Test fun branded_stack_ownership_verified() =
        renderAndAssert(PaywallTemplate.BRANDED_STACK, verifiedState, "Your subscription is now active")

    // BRANDED_STACK — content-field assertions (v2 PaywallDto fields)

    /**
     * Default [PaywallDto.heroSubtitle] must be visible in the Free state alongside
     * the hero title, confirming both hero copy slots render.
     */
    @Test fun branded_stack_free_hero_subtitle_renders() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = BillingState.Free,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        // Default heroSubtitle is "Enjoy ad-free experience, HD downloads, and exclusive features"
        onNodeWithText("Enjoy ad-free experience", substring = true).assertExists()
    }

    /**
     * The branded CTA button must carry the [PaywallDto.ctaContinue] label ("Continue"
     * by default) — this is distinct from any plan-card text and is exclusive to
     * BrandedStackTemplate's CTA row.
     */
    @Test fun branded_stack_free_cta_button_renders() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = BillingState.Free,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithText("Continue", substring = false).assertExists()
    }

    /**
     * The micro-footer must surface the uppercased [PaywallDto.restoreLabel].
     * Default is "Restore Your Premium" → uppercased to "RESTORE YOUR PREMIUM".
     */
    @Test fun branded_stack_free_restore_footer_renders() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = BillingState.Free,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithText("RESTORE YOUR PREMIUM", substring = true).assertExists()
    }

    /**
     * When [PaywallDto.valueProps] is non-empty the value-prop list renders each
     * item's [ValuePropTriple.title] and optional [ValuePropTriple.description].
     * Uses [CompositionLocalProvider] to inject a custom config so the list renders.
     */
    @Test fun branded_stack_free_value_props_render() = runComposeUiTest {
        val customConfig = SuiteConfig(
            tenantId = "test-tenant",
            paywall = PaywallDto(
                valueProps = listOf(
                    ValuePropTriple(icon = "star", title = "Unlimited Downloads", description = "No daily cap"),
                    ValuePropTriple(icon = "hd", title = "HD Quality", description = null),
                ),
            ),
        )
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides customConfig) {
                PaywallTemplate.BRANDED_STACK.render(
                    state = BillingState.Free,
                    products = sampleProducts,
                    onPickProduct = {},
                    onRetry = {},
                )
            }
        }
        onNodeWithText("Unlimited Downloads", substring = false).assertExists()
        onNodeWithText("No daily cap", substring = false).assertExists()
        onNodeWithText("HD Quality", substring = false).assertExists()
    }

    /**
     * When [PaywallDto.popularPlanSku] matches one of the products the plan card
     * for that SKU shows the "MOST POPULAR" badge (rendered by [PlanCard] when
     * `popular = true`). A non-matching SKU must NOT show the badge.
     */
    @Test fun branded_stack_free_popular_plan_badge_renders() = runComposeUiTest {
        val configWithPopular = SuiteConfig(
            tenantId = "test-tenant",
            paywall = PaywallDto(popularPlanSku = "monthly"),
        )
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides configWithPopular) {
                PaywallTemplate.BRANDED_STACK.render(
                    state = BillingState.Free,
                    products = sampleProducts,
                    onPickProduct = {},
                    onRetry = {},
                )
            }
        }
        // PlanCard emits "MOST POPULAR" text only for the popular plan
        onNodeWithText("MOST POPULAR", substring = false).assertExists()
        // The popular plan's display name still renders inside its card
        onNodeWithText("Monthly", substring = false).assertExists()
    }

    /**
     * Default branding ("attribution") emits "Powered by PayCraft by MobileByteSensei"
     * in the micro-footer. This is the tier-aware branding line unique to
     * BrandedStackTemplate — not present in MINIMAL/PREMIUM/DARK.
     */
    @Test fun branded_stack_free_attribution_branding_renders() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = BillingState.Free,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithText("Powered by PayCraft by MobileByteSensei", substring = true).assertExists()
    }

    /**
     * Premium state emits the active plan name and renewal date from [BillingState.Premium].
     * Asserts the plan label ("Plan: monthly") and renewal ("Renews 2027-01-01") are visible.
     */
    @Test fun branded_stack_premium_shows_plan_and_renewal() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = premiumState,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithText("Plan: monthly", substring = false).assertExists()
        onNodeWithText("Renews 2027-01-01", substring = false).assertExists()
    }

    /**
     * Premium state with a live trial shows the remaining days from [TrialInfo].
     */
    @Test fun branded_stack_premium_shows_trial_days_remaining() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = premiumState,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithText("Trial: 5 days remaining", substring = false).assertExists()
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

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
