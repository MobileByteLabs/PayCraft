/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Behaviour tests for the Phase-4 PayCraft monetization API:
 *   • presentPaywall / presentPaywallIfNeeded are always-public (AC-10) and
 *     presentPaywallIfNeeded no-ops when the entitlement is already active.
 *   • Cloud SuiteConfig.mode wins over the init-flag (AC-9).
 *   • MonetizationMode.TrialManaged auto-presents on onAppOpen when the trial
 *     is active AND buyer is not premium AND the once-per-session debounce is
 *     clear (AC-11); does NOT auto-present when premium, when no trial exists,
 *     or on a repeat onAppOpen within the same process.
 *   • MonetizationMode.AdSupported never auto-presents and exposes the correct
 *     isAdFree flag (AC-12).
 *
 * The suite injects EntitlementSnapshot + TrialSnapshot values directly so no
 * live server (or Koin graph / BillingManager fake) is required — the fake/
 * injected clock+state discipline the task prompt calls for. Tests run on the
 * :cmp-paycraft:jvmTest Skiko-desktop lane alongside every other commonTest.
 */
package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.AdFreeEntitlement
import com.mobilebytelabs.paycraft.core.EntitlementSnapshot
import com.mobilebytelabs.paycraft.core.MonetizationMode
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.core.SessionDebounce
import com.mobilebytelabs.paycraft.core.TrialSnapshot
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PayCraftMonetizationTest {

    // Reset every process-wide singleton the API touches so tests are
    // order-independent. PayCraft is an `object`, so its state (resolved mode,
    // paywall presentation flow, applied SuiteConfig) survives across tests
    // unless we drive a fresh initialize() at the top of every scenario.
    @BeforeTest
    fun resetSingletons() {
        AdFreeEntitlement.resetForTest()
        SessionDebounce.resetForTest()
        // Force paywallPresentation back to Hidden — the previous test may have
        // left it Shown. Calling dismissPaywall() before initialize() would fail
        // if PayCraft were uninitialized, but dismissPaywall() only touches the
        // internal MutableStateFlow and works pre-init too.
        PayCraft.dismissPaywall()
    }

    @AfterTest
    fun clearAfter() {
        AdFreeEntitlement.resetForTest()
        SessionDebounce.resetForTest()
        PayCraft.dismissPaywall()
    }

    // ─── AC-10 — both present APIs are ALWAYS public regardless of mode ────

    @Test
    fun presentPaywall_is_public_and_emits_manual_trigger() {
        PayCraft.initialize(
            apiKey = "pk_test_present-manual",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )
        assertIs<PaywallPresentation.Hidden>(PayCraft.paywallPresentation.value)

        PayCraft.presentPaywall()

        val shown = PayCraft.paywallPresentation.value
        assertIs<PaywallPresentation.Shown>(shown)
        assertEquals(PaywallPresentation.Shown.Trigger.Manual, shown.trigger)
    }

    @Test
    fun presentPaywallIfNeeded_shows_when_entitlement_inactive() {
        PayCraft.initialize(
            apiKey = "pk_test_ifneeded-inactive",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )
        assertEquals(false, PayCraft.isAdFree.value)

        PayCraft.presentPaywallIfNeeded()

        val shown = PayCraft.paywallPresentation.value
        assertIs<PaywallPresentation.Shown>(shown)
        assertEquals(PaywallPresentation.Shown.Trigger.IfNeeded, shown.trigger)
        assertEquals("premium", shown.entitlement)
    }

    @Test
    fun presentPaywallIfNeeded_noOps_when_entitlement_already_active() {
        PayCraft.initialize(
            apiKey = "pk_test_ifneeded-noop",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )
        // Simulate the buyer already having a premium entitlement — the SDK's
        // AC-10 no-op path MUST fire and leave the presentation Hidden.
        AdFreeEntitlement.set(true)

        PayCraft.presentPaywallIfNeeded()

        assertIs<PaywallPresentation.Hidden>(
            PayCraft.paywallPresentation.value,
            "presentPaywallIfNeeded MUST be a no-op when the entitlement is active",
        )
    }

    @Test
    fun presentPaywallIfNeeded_custom_entitlement_records_name() {
        PayCraft.initialize(
            apiKey = "pk_test_ifneeded-custom",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )
        PayCraft.presentPaywallIfNeeded(entitlement = "hd_downloads")

        val shown = PayCraft.paywallPresentation.value
        assertIs<PaywallPresentation.Shown>(shown)
        assertEquals("hd_downloads", shown.entitlement)
    }

    // ─── AC-9 — cloud SuiteConfig.mode wins over the init flag ──────────────

    @Test
    fun cloud_mode_overrides_init_flag_via_applySuiteConfig() {
        // Init with AdSupported, then land a cloud SuiteConfig carrying mode=TrialManaged.
        // The resolver must flip PayCraft.monetizationMode to the cloud value.
        val suiteWithTrialMode = minimalSuite().copy(mode = MonetizationMode.TrialManaged)
        PayCraft.initialize(
            apiKey = "pk_test_config-wins",
            backend = PayCraftBackend.Mock(staticConfig = suiteWithTrialMode),
            mode = MonetizationMode.AdSupported,
        )
        // Mock backend applies the static config synchronously inside initialize().
        assertEquals(
            MonetizationMode.TrialManaged,
            PayCraft.monetizationMode,
            "cloud SuiteConfig.mode MUST win over the init flag (AC-9)",
        )
    }

    @Test
    fun init_flag_used_when_cloud_mode_absent() {
        // The minimalSuite() helper has no `mode` field — resolver must return init flag.
        PayCraft.initialize(
            apiKey = "pk_test_config-absent",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )
        assertEquals(
            MonetizationMode.TrialManaged,
            PayCraft.monetizationMode,
            "when cloud mode is null the init flag MUST be the resolved mode",
        )
    }

    // ─── AC-11 — TrialManaged auto-present rules + debounce ─────────────────

    @Test
    fun trial_managed_autoPresents_on_appOpen_with_active_trial() {
        PayCraft.initialize(
            apiKey = "pk_test_trial-active",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )

        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = false),
            trial = TrialSnapshot(isActive = true, hasEnded = false, daysRemaining = 5),
        )

        val shown = PayCraft.paywallPresentation.value
        assertIs<PaywallPresentation.Shown>(shown)
        assertEquals(PaywallPresentation.Shown.Trigger.TrialManagedAppOpen, shown.trigger)
    }

    @Test
    fun trial_managed_autoPresents_on_appOpen_when_trial_just_ended() {
        // The convert-or-churn moment — buyer opens the app the day after their
        // trial ended, sees the paywall to upgrade.
        PayCraft.initialize(
            apiKey = "pk_test_trial-ended",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )

        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = false),
            trial = TrialSnapshot(isActive = false, hasEnded = true, daysRemaining = 0),
        )

        assertIs<PaywallPresentation.Shown>(PayCraft.paywallPresentation.value)
    }

    @Test
    fun trial_managed_does_not_autoPresent_when_buyer_is_premium() {
        PayCraft.initialize(
            apiKey = "pk_test_trial-premium",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )

        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = true),
            trial = TrialSnapshot(isActive = true, hasEnded = false, daysRemaining = 3),
        )

        assertIs<PaywallPresentation.Hidden>(
            PayCraft.paywallPresentation.value,
            "premium buyer MUST NOT be nagged by an auto-present paywall",
        )
    }

    @Test
    fun trial_managed_does_not_autoPresent_when_no_trial_exists() {
        PayCraft.initialize(
            apiKey = "pk_test_trial-none",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )

        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = false),
            trial = TrialSnapshot.None,
        )

        assertIs<PaywallPresentation.Hidden>(
            PayCraft.paywallPresentation.value,
            "a buyer who never had a trial MUST NOT see the auto-presented paywall",
        )
    }

    @Test
    fun trial_managed_debounces_once_per_session() {
        PayCraft.initialize(
            apiKey = "pk_test_trial-debounce",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )
        val entitlement = EntitlementSnapshot(isPremium = false)
        val trial = TrialSnapshot(isActive = true, hasEnded = false, daysRemaining = 4)

        // First onAppOpen fires the auto-present and marks the debounce.
        PayCraft.onAppOpen(entitlement, trial)
        assertIs<PaywallPresentation.Shown>(PayCraft.paywallPresentation.value)
        assertTrue(SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY))

        // Host dismisses the sheet — presentation goes back to Hidden.
        PayCraft.dismissPaywall()
        assertIs<PaywallPresentation.Hidden>(PayCraft.paywallPresentation.value)

        // Second onAppOpen in the same process (a background/foreground cycle) MUST
        // NOT re-present — the debounce mark prevents re-nagging the same session.
        PayCraft.onAppOpen(entitlement, trial)
        assertIs<PaywallPresentation.Hidden>(
            PayCraft.paywallPresentation.value,
            "TrialManaged auto-present MUST debounce once-per-session (AC-11)",
        )
    }

    // ─── AC-12 — AdSupported never auto-presents; isAdFree tracks premium ──

    @Test
    fun ad_supported_never_autoPresents_on_appOpen_even_with_active_trial() {
        PayCraft.initialize(
            apiKey = "pk_test_ad-noautopresent",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )

        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = false),
            trial = TrialSnapshot(isActive = true, hasEnded = false, daysRemaining = 5),
        )

        assertIs<PaywallPresentation.Hidden>(
            PayCraft.paywallPresentation.value,
            "AdSupported mode MUST NEVER auto-present — the host owns paywall triggering",
        )
        // The debounce key stays clear because the branch never marks it.
        assertEquals(false, SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY))
    }

    @Test
    fun ad_supported_exposes_correct_isAdFree_on_appOpen() {
        PayCraft.initialize(
            apiKey = "pk_test_ad-isadfree",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.AdSupported,
        )
        assertEquals(false, PayCraft.isAdFree.value)

        // Premium buyer → isAdFree becomes true.
        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = true),
            trial = TrialSnapshot.None,
        )
        assertEquals(
            true,
            PayCraft.isAdFree.value,
            "isAdFree MUST reflect the buyer's premium status (AC-12)",
        )

        // Downgrade — subsequent onAppOpen with isPremium=false resets the flag.
        PayCraft.onAppOpen(
            entitlement = EntitlementSnapshot(isPremium = false),
            trial = TrialSnapshot.None,
        )
        assertEquals(false, PayCraft.isAdFree.value)
    }

    @Test
    fun manual_presentPaywall_still_works_in_trial_managed_mode() {
        // Both APIs are always-public regardless of mode (GOAL D3 union design).
        PayCraft.initialize(
            apiKey = "pk_test_trial-manual",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuite()),
            mode = MonetizationMode.TrialManaged,
        )
        PayCraft.presentPaywall()
        val shown = PayCraft.paywallPresentation.value
        assertIs<PaywallPresentation.Shown>(shown)
        assertEquals(PaywallPresentation.Shown.Trigger.Manual, shown.trigger)
    }

    // ─── Fixtures ────────────────────────────────────────────────────────────

    private fun minimalSuite(): SuiteConfig = SuiteConfig(
        tenantId = "phase4-test-tenant",
        products = listOf(
            ProductDto(
                id = "p1",
                sku = "monthly",
                type = "subscription",
                displayName = "Monthly",
                interval = "month",
                basePriceCents = 999,
                baseCurrency = "USD",
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinksBySku = mapOf("monthly" to mapOf("USD" to "https://test.link/monthly")),
            ),
        ),
        paywall = PaywallDto(supportEmail = "support@example.com"),
    )
}
