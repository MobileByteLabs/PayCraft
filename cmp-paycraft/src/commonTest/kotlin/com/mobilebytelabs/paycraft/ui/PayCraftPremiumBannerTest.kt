package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.SubscriptionActivated
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.test.Test

/**
 * Compose UI tests for [PayCraftPremiumBanner].
 *
 * Exercises DTO-driven copy (via [LocalPayCraftConfig]) and per-call *Override params,
 * plus the billing-state-aware behavior (shimmer while loading, collapse when premium,
 * upgrade card when free). Every copy test injects a [FakeBillingManager] pinned to
 * [BillingState.Free] so the banner renders its upgrade card (a null manager now renders
 * a shimmer, so the copy would otherwise be absent).
 *
 * Uses [runComposeUiTest] (commonTest-friendly) matching the pattern in PaywallTemplateTest.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftPremiumBannerTest {

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun suiteConfig(paywall: PaywallDto) = SuiteConfig(
        tenantId = "test-tenant",
        paywall = paywall,
    )

    /** Free-state manager — the copy tests assert the upgrade card is rendered. */
    private fun freeManager(state: BillingState = BillingState.Free) = FakeBillingManager(state)

    /**
     * Minimal in-memory [BillingManager] for Compose UI tests — drives [billingState]
     * without any Koin container or real network. Mirrors the fake in
     * PayCraftRestoreContentTest.
     */
    private class FakeBillingManager(initialState: BillingState = BillingState.Free) : BillingManager {
        private val _billingState = MutableStateFlow(initialState)
        override val billingState: StateFlow<BillingState> = _billingState

        private val _isPremium = MutableStateFlow(initialState is BillingState.Premium)
        override val isPremium: StateFlow<Boolean> = _isPremium

        private val _subscriptionStatus = MutableStateFlow(SubscriptionStatus())
        override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus

        private val _userEmail = MutableStateFlow<String?>(null)
        override val userEmail: StateFlow<String?> = _userEmail

        private val _subscriptionActivated = MutableSharedFlow<SubscriptionActivated>(replay = 0)
        override val subscriptionActivated: SharedFlow<SubscriptionActivated> = _subscriptionActivated

        private val _isInTrial = MutableStateFlow(false)
        override val isInTrial: StateFlow<Boolean> = _isInTrial

        private val _trialEndsAt = MutableStateFlow<String?>(null)
        override val trialEndsAt: StateFlow<String?> = _trialEndsAt

        override fun registerAndLogin(email: String) { /* no-op */ }
        override fun logIn(email: String) = registerAndLogin(email)
        override fun purchaseViaPlayBilling(plan: BillingPlan, email: String?) { /* no-op */ }
        override fun purchaseViaStoreKit(plan: BillingPlan, email: String?) { /* no-op */ }
        override suspend fun checkTrialEligibility(): Boolean = true
        override fun refreshStatus(force: Boolean) { /* no-op */ }
        override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) { /* no-op */ }
        override suspend fun confirmDeviceTransfer() { /* no-op */ }
        override suspend fun transferToDevice() { /* no-op */ }
        override suspend fun revokeCurrentDevice() { /* no-op */ }
        override fun logOut() { /* no-op */ }
    }

    // ── DTO-driven copy ───────────────────────────────────────────────────────

    @Test
    fun banner_renders_dto_hero_title() = runComposeUiTest {
        val paywall = PaywallDto(heroTitle = "Level Up Your Experience")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Level Up Your Experience", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_hero_subtitle() = runComposeUiTest {
        val paywall = PaywallDto(heroSubtitle = "Unlock unlimited access for all features")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Unlock unlimited access for all features", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_cta_label() = runComposeUiTest {
        val paywall = PaywallDto(ctaGetPremium = "Go Premium Now")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Go Premium Now", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_restore_label() = runComposeUiTest {
        val paywall = PaywallDto(restoreLabel = "Restore My Purchase")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Restore My Purchase", substring = true).assertExists()
    }

    // ── Default PaywallDto copy (no CompositionLocal provider) ───────────────

    @Test
    fun banner_uses_defaults_when_no_config_provided() = runComposeUiTest {
        // LocalPayCraftConfig defaults to null; banner falls back to PaywallDto()
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_subtitle_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Enjoy ad-free experience", substring = true).assertExists()
    }

    @Test
    fun banner_default_cta_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Get Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_restore_label_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Restore Your Premium", substring = true).assertExists()
    }

    // ── *Override params take precedence over DTO ─────────────────────────────

    @Test
    fun title_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(heroTitle = "DTO Title")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    titleOverride = "Pinned Title",
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("Pinned Title", substring = true).assertExists()
        // DTO value must not appear when override is set
        onNodeWithText("DTO Title").assertDoesNotExist()
    }

    @Test
    fun subtitle_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(heroSubtitle = "DTO Subtitle")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    subtitleOverride = "Pinned Subtitle",
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("Pinned Subtitle", substring = true).assertExists()
        onNodeWithText("DTO Subtitle").assertDoesNotExist()
    }

    @Test
    fun cta_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(ctaGetPremium = "DTO CTA")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    ctaOverride = "Pinned CTA",
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("Pinned CTA", substring = true).assertExists()
        onNodeWithText("DTO CTA").assertDoesNotExist()
    }

    @Test
    fun restore_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(restoreLabel = "DTO Restore")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    restoreOverride = "Pinned Restore",
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("Pinned Restore", substring = true).assertExists()
        onNodeWithText("DTO Restore").assertDoesNotExist()
    }

    // ── Billing-state awareness (Bug B) ───────────────────────────────────────

    @Test
    fun loading_state_renders_shimmer_not_upgrade_card() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(BillingState.Loading),
            )
        }
        // Shimmer pill is present; the stale "Upgrade" copy is not.
        // The banner shimmer renders three pills, each tagged — assert at least one exists.
        onAllNodesWithTag(PayCraftTestTags.BANNER_SHIMMER).onFirst().assertExists()
        onNodeWithText("Upgrade to Premium", substring = true).assertDoesNotExist()
    }

    @Test
    fun null_manager_pre_init_renders_shimmer() = runComposeUiTest {
        // A null billing manager (pre-init / no Koin) is treated as Loading.
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = null)
        }
        // The banner shimmer renders three pills, each tagged — assert at least one exists.
        onAllNodesWithTag(PayCraftTestTags.BANNER_SHIMMER).onFirst().assertExists()
    }

    @Test
    fun premium_state_collapses_to_nothing() = runComposeUiTest {
        val premium = BillingState.Premium(
            status = SubscriptionStatus(isPremium = true, plan = "monthly"),
            trial = null,
        )
        setContent {
            PayCraftPremiumBanner(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(premium),
            )
        }
        // Premium buyers are never upsold — no upgrade copy and no shimmer.
        onAllNodesWithText("Upgrade to Premium", substring = true).assertCountEquals(0)
        onNodeWithTag(PayCraftTestTags.BANNER_SHIMMER).assertDoesNotExist()
    }

    @Test
    fun free_state_renders_upgrade_card() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(BillingState.Free),
            )
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertExists()
        onNodeWithTag(PayCraftTestTags.BANNER_SHIMMER).assertDoesNotExist()
    }
}
