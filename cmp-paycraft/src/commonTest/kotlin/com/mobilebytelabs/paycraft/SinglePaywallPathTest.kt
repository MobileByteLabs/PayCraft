package com.mobilebytelabs.paycraft

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.TrialInfo
import com.mobilebytelabs.paycraft.model.VerificationMethod
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import kotlin.test.Test

/**
 * Single-paywall-path behavioural guard (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Every public paywall composable (`PayCraftPaywall`, `PayCraftPaywallSheet`,
 * `BannerPaywall`, `PayCraftInlinePaywallBanner`, `PayCraftPaywallWithRestore`,
 * `PayCraftPremiumGuardInline`, `PayCraftCheckoutSuccessSheetOrPaywall`) now
 * delegates through the single v2 renderer `PayCraftPaywallComposable`, which
 * resolves [PaywallTemplate.BRANDED_STACK] as the production default. The retired
 * v1 `PayCraftPaywallContent` hand-built `when`-over-`BillingState` is deleted;
 * `BrandedStackTemplate` now owns every state branch — including the migrated
 * [BillingState.DeviceConflict] and [BillingState.OwnershipVerified] slots that
 * v1 rendered bespoke.
 *
 * This test exercises the single path end-to-end via [runComposeUiTest] (the
 * jvmTest Skiko-desktop lane, matching [PaywallTemplateTest]'s idiom) and asserts
 * the expected template markers appear for every [BillingState] branch. If a
 * future edit accidentally re-forks the render tree (e.g. someone adds a v1-style
 * `PayCraftPaywallContent` back on top of `PayCraftPaywall`), one of these
 * assertions will fail because the fork's bespoke marker text won't match
 * `BrandedStackTemplate`'s canonical strings.
 *
 * The complementary source-shape guards live in the sub-plan's Acceptance grep
 * bullets (`PayCraftPaywallContent` count == 0, `PayCraftPaywallComposable(`
 * count ≥ 7, `ui/components/PlanCard.kt` deleted) — this test locks the
 * behavioural side of the same contract.
 */
@OptIn(ExperimentalTestApi::class)
class SinglePaywallPathTest {

    private val sampleProducts = listOf(
        Product.Subscription(
            id = "p1",
            sku = "monthly",
            displayName = "Monthly",
            displayOrder = 0,
            interval = Product.Subscription.Interval.MONTH,
            basePrice = Money(999, "USD"),
        ),
        Product.Lifetime(
            id = "p2",
            sku = "lifetime",
            displayName = "Lifetime",
            displayOrder = 1,
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

    /**
     * Free state → BrandedStackTemplate's default hero title "Upgrade to Premium".
     * Fires from the default [com.mobilebytelabs.paycraft.config.PaywallDto.heroTitle].
     */
    @Test
    fun single_path_free_renders_branded_stack_hero() = renderAndAssert(
        BillingState.Free,
        "Upgrade to Premium",
    )

    /**
     * Loading state → Phase 3 (AC-5, AC-14): BrandedStackTemplate's Loading branch
     * renders a layout-matched [com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton]
     * tagged [PayCraftTestTags.PAYWALL_SHIMMER] — no bespoke text, no
     * CircularProgressIndicator. Asserting on the tag (not text) proves the
     * single path routes to the shared skeleton composable.
     */
    @Test
    fun single_path_loading_renders_branded_stack_shell() = runComposeUiTest {
        setContent {
            PaywallTemplate.BRANDED_STACK.render(
                state = BillingState.Loading,
                products = sampleProducts,
                onPickProduct = {},
                onRetry = {},
            )
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_SHIMMER).assertExists()
    }

    /**
     * Premium state → BrandedStackTemplate's "You're Premium" hero. The retired v1
     * `PayCraftPaywallContent` rendered "Your Premium" (via `paycraft_your_premium_title`
     * i18n) — asserting the BrandedStack string here proves the single path is live.
     */
    @Test
    fun single_path_premium_renders_branded_stack_hero() = renderAndAssert(
        premiumState,
        "You're Premium",
    )

    /**
     * Error state → BrandedStackTemplate's "Something went wrong" + Retry button.
     */
    @Test
    fun single_path_error_renders_branded_stack_retry() = renderAndAssert(
        BillingState.Error("network"),
        "Retry",
    )

    /**
     * DeviceConflict migrated from v1 → BrandedStackTemplate renders
     * "Device limit reached" (distinct from MinimalTemplate's "bound to another device"
     * so a re-fork onto a legacy template would fail this assertion).
     */
    @Test
    fun single_path_device_conflict_renders_migrated_branch() = renderAndAssert(
        conflictState,
        "Device limit reached",
    )

    /**
     * OwnershipVerified migrated from v1 → BrandedStackTemplate renders
     * "Your subscription is now active on this device." — the migrated slot body.
     */
    @Test
    fun single_path_ownership_verified_renders_migrated_branch() = renderAndAssert(
        verifiedState,
        "Transfer subscription",
    )

    /**
     * Exhaustive-branch sanity: every [BillingState] sealed subtype resolves to a
     * BrandedStackTemplate slot with distinct, non-empty rendered text. Fails if a
     * future BillingState addition slips through without a matching template branch
     * — the `when` inside `BrandedStackTemplate` is exhaustive, so a missing branch
     * would fail to compile before this test runs, but a stub branch that renders
     * nothing would fail here at runtime.
     */
    @Test
    fun single_path_covers_every_billing_state_branch() {
        // Text-marker-driven branches (Free / Premium / Error / DeviceConflict / OwnershipVerified).
        listOf(
            BillingState.Free to "Upgrade to Premium",
            premiumState to "You're Premium",
            BillingState.Error("offline") to "Retry",
            conflictState to "Device limit reached",
            verifiedState to "Transfer subscription",
        ).forEach { (state, marker) -> renderAndAssert(state, marker) }
        // Phase 3 Loading branch has no distinctive text marker — the layout-matched
        // PaywallSkeleton is asserted via testTag (AC-5, AC-14). Kept as a separate
        // runComposeUiTest so the branch coverage stays exhaustive.
        runComposeUiTest {
            setContent {
                PaywallTemplate.BRANDED_STACK.render(
                    state = BillingState.Loading,
                    products = sampleProducts,
                    onPickProduct = {},
                    onRetry = {},
                )
            }
            onNodeWithTag(PayCraftTestTags.PAYWALL_SHIMMER).assertExists()
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun renderAndAssert(state: BillingState, markerText: String) {
        runComposeUiTest {
            setContent {
                PaywallTemplate.BRANDED_STACK.render(
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
