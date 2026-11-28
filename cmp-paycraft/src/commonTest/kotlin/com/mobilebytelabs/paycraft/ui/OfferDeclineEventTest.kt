package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
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
import kotlin.test.assertTrue

/** "No thanks" on the win-back offer is `paycraft_offer_decline`, once; skipping the survey itself is not. */
class OfferDeclineEventTest {

    private val captured = mutableListOf<PayCraftEvent>()
    private val cfg = ExitSurveyConfig(
        enabled = true,
        title = "What stopped you?",
        capDays = 7,
        reasons = listOf(
            ExitSurveyConfig.Reason("too_expensive", "Too expensive", "offer", offer = ExitSurveyConfig.Offer(50)),
        ),
    )
    private val offer = WinbackOffer(
        id = "o1", percentOff = 50, duration = "once", durationInMonths = null, expiresAtIso = "2099-01-01T00:00:00Z",
        sku = "pro-monthly", stripe = true, razorpay = true, googlePlayOfferId = null, appStoreOffer = null,
    )

    @BeforeTest fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest fun tearDown() = Dispatchers.resetMain()

    private fun closedToSurvey(answer: WinbackResult) =
        PayCraftPaywallViewModel(FakeBillingManager(premium = false)).apply {
            funnel = PaywallFunnelTracker(emit = { captured += it }, now = { 1L })
            surveyConfig = { cfg }
            surveyGate = ExitSurveyGate(MapSettings(), now = { 1_000L })
            winback = { _, _, _, _ -> answer }
            onShown()
            dispatch(PayCraftPaywallAction.Dismiss)
        }

    @Test fun no_thanks_on_the_offer_is_one_decline() {
        val vm = closedToSurvey(WinbackResult.Offer(offer))
        vm.onSurveyAnswer("too_expensive", null)
        vm.closeSurvey()
        vm.closeSurvey() // a second close finds no offer on screen
        val declines = captured.filter { it.name == PayCraftEventName.OfferDecline }
        assertEquals(1, declines.size, captured.map { it.name }.toString())
        assertEquals(PayCraftStep.Offer, declines.single().step)
    }

    @Test fun skipping_the_survey_is_not_a_decline() {
        val vm = closedToSurvey(WinbackResult.Offer(offer))
        vm.closeSurvey()
        assertTrue(captured.none { it.name == PayCraftEventName.OfferDecline }, captured.map { it.name }.toString())
    }
}
