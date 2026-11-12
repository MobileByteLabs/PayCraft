package com.mobilebytelabs.paycraft.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import com.mobilebytelabs.paycraft.winback.ExitSurveyGate
import com.mobilebytelabs.paycraft.winback.WinbackOffer
import com.mobilebytelabs.paycraft.winback.WinbackResult
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.koin.compose.KoinApplication
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The exit survey in the mobile paywall (paycraft-paywall-analytics AC-8): closing the paywall shows the
 * survey IN THE SAME SURFACE (never a second sheet); "too expensive" with a tenant offer shows the offer and
 * "Claim" carries it into checkout; "just looking" closes; the survey is not shown again inside its cap; and
 * each step is an analytics event.
 */
@OptIn(ExperimentalTestApi::class)
class ExitSurveyContentTest {

    private val cfg = ExitSurveyConfig(
        enabled = true,
        title = "Before you go — what stopped you?",
        capDays = 7,
        reasons = listOf(
            ExitSurveyConfig.Reason("too_expensive", "It's too expensive", "offer", offer = ExitSurveyConfig.Offer(50)),
            ExitSurveyConfig.Reason("just_looking", "I'm just looking", "none"),
        ),
    )
    private val offer = WinbackOffer(
        id = "o1", percentOff = 50, duration = "once", durationInMonths = null, expiresAtIso = "2099-01-01T00:00:00Z",
        sku = "pro-monthly", stripe = true, razorpay = true, googlePlayOfferId = "winback-50", appStoreOffer = null,
    )
    private val events = mutableListOf<PayCraftEvent>()
    private var dismissed = 0

    @BeforeTest fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        PayCraft.activeWinbackOffer = null
    }

    @AfterTest fun tearDown() {
        Dispatchers.resetMain()
        PayCraft.activeWinbackOffer = null
    }

    private fun vmSetup(vm: PayCraftPaywallViewModel, store: MapSettings, answer: WinbackResult) {
        vm.funnel = PaywallFunnelTracker(emit = { events += it }, now = { 1L })
        vm.surveyConfig = { cfg }
        vm.surveyGate = ExitSurveyGate(store, now = { 1_000L })
        vm.winback = { _, _, _, _ -> answer }
    }

    @Test fun closing_shows_the_survey_and_too_expensive_shows_the_offer_which_claim_carries_to_checkout() =
        runComposeUiTest {
            lateinit var vm: PayCraftPaywallViewModel
            val store = MapSettings()
            setContent {
                KoinApplication(application = {
                    modules(
                        module {
                            single<BillingManager> { FakeBillingManager(premium = false) }
                            viewModelOf(::PayCraftPaywallViewModel)
                        },
                    )
                }) {
                    vm = koinViewModel()
                    vmSetup(vm, store, WinbackResult.Offer(offer))
                    PayCraftPaywallComposable(onDismiss = { dismissed++ }, surfaceMode = PayCraftSurfaceMode.Sheet)
                }
            }
            waitForIdle()
            vm.onShown()
            vm.dispatch(PayCraftPaywallAction.Dismiss)
            waitForIdle()
            onNodeWithTag(PayCraftTestTags.EXIT_SURVEY).assertIsDisplayed()
            onNodeWithText("Before you go — what stopped you?").assertIsDisplayed()
            assertEquals(0, dismissed, "the survey replaces the paywall; the host is not told to close yet")

            onNodeWithTag(PayCraftTestTags.exitReason("too_expensive")).performClick()
            waitForIdle()
            onNodeWithTag(PayCraftTestTags.WINBACK_OFFER).assertIsDisplayed()
            onNodeWithText("50% off").assertIsDisplayed()

            onNodeWithTag(PayCraftTestTags.WINBACK_CLAIM).performClick()
            waitForIdle()
            assertEquals("o1", PayCraft.activeWinbackOffer?.id, "the claimed offer rides into checkout")
            val names = events.map { it.name }
            assertTrue(
                names.containsAll(
                    listOf(
                        PayCraftEventName.StepAbandon,
                        PayCraftEventName.SurveyView,
                        PayCraftEventName.SurveyAnswer,
                        PayCraftEventName.OfferView,
                        PayCraftEventName.OfferAccept,
                    ),
                ),
                names.toString(),
            )
            assertEquals("too_expensive", events.first { it.name == PayCraftEventName.SurveyAnswer }.reason)
        }

    @Test fun just_looking_closes_and_the_survey_is_not_shown_again_inside_its_cap() = runComposeUiTest {
        lateinit var vm: PayCraftPaywallViewModel
        val store = MapSettings()
        setContent {
            KoinApplication(application = {
                modules(
                    module {
                        single<BillingManager> { FakeBillingManager(premium = false) }
                        viewModelOf(::PayCraftPaywallViewModel)
                    },
                )
            }) {
                vm = koinViewModel()
                vmSetup(vm, store, WinbackResult.None)
                PayCraftPaywallComposable(onDismiss = { dismissed++ }, surfaceMode = PayCraftSurfaceMode.Sheet)
            }
        }
        waitForIdle()
        vm.onShown()
        vm.dispatch(PayCraftPaywallAction.Dismiss)
        waitForIdle()
        onNodeWithTag(PayCraftTestTags.exitReason("just_looking")).performClick()
        waitForIdle()
        assertEquals(1, dismissed, "'just looking' closes the paywall")
        assertNull(PayCraft.activeWinbackOffer)

        // Open and close again within the 7-day cap: no survey, straight close.
        vm.onShown()
        vm.dispatch(PayCraftPaywallAction.Dismiss)
        waitForIdle()
        assertEquals(2, dismissed)
        assertEquals(1, events.count { it.name == PayCraftEventName.SurveyView })
    }
}
