package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
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
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** Closing the paywall shows the exit offer first (migration 226); declining it asks the survey. */
class ExitOfferFlowTest {

    private val captured = mutableListOf<PayCraftEvent>()
    private val calls = mutableListOf<String>()
    private val reason = ExitSurveyConfig.Reason("too_expensive", "Too expensive")
    private val exitOffer = ExitSurveyConfig.Offer(50, "repeating", 3)
    private val offer = WinbackOffer(
        id = "o1", percentOff = 50, duration = "repeating", durationInMonths = 3, expiresAtIso = "2099-01-01T00:00:00Z",
        sku = "pro-monthly", stripe = false, razorpay = false, googlePlayOfferId = "exit50", appStoreOffer = null,
    )

    @BeforeTest fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest fun tearDown() = Dispatchers.resetMain()

    private fun closed(cfg: ExitSurveyConfig, answer: WinbackResult = WinbackResult.Offer(offer)) =
        PayCraftPaywallViewModel(FakeBillingManager(premium = false)).apply {
            funnel = PaywallFunnelTracker(emit = { captured += it }, now = { 1L })
            surveyConfig = { cfg }
            surveyGate = ExitSurveyGate(MapSettings(), now = { 1_000L })
            winback = { code, _, _, _ ->
                calls += code
                answer
            }
            onShown()
            dispatch(PayCraftPaywallAction.Dismiss)
        }

    private fun cfg(reasons: List<ExitSurveyConfig.Reason> = listOf(reason), exit: ExitSurveyConfig.Offer? = exitOffer) =
        ExitSurveyConfig(enabled = true, title = "Why?", reasons = reasons, exitOffer = exit)

    @Test fun close_shows_the_exit_offer_first_then_the_survey_on_no_thanks() {
        val vm = closed(cfg())
        assertEquals(listOf(EXIT_OFFER), calls)
        val shown = assertIs<ExitSurveyUi.OfferShown>(vm.survey.value)
        assertEquals(50, shown.offer.percentOff)
        vm.closeSurvey()
        assertIs<ExitSurveyUi.Asking>(vm.survey.value)
        val names = captured.map { it.name }
        assertEquals(
            listOf(PayCraftEventName.OfferView, PayCraftEventName.OfferDecline, PayCraftEventName.SurveyView),
            names.filter { it in setOf(PayCraftEventName.OfferView, PayCraftEventName.OfferDecline, PayCraftEventName.SurveyView) },
        )
    }

    @Test fun no_offer_from_the_server_falls_back_to_the_survey() {
        val vm = closed(cfg(), WinbackResult.None)
        assertIs<ExitSurveyUi.Asking>(vm.survey.value)
    }

    @Test fun exit_offer_without_reasons_closes_on_no_thanks() {
        val vm = closed(cfg(reasons = emptyList()))
        assertIs<ExitSurveyUi.OfferShown>(vm.survey.value)
        vm.closeSurvey()
        assertNull(vm.survey.value)
    }

    @Test fun no_exit_offer_asks_the_survey_directly() {
        val vm = closed(cfg(exit = null))
        assertEquals(emptyList(), calls)
        assertIs<ExitSurveyUi.Asking>(vm.survey.value)
    }
}
