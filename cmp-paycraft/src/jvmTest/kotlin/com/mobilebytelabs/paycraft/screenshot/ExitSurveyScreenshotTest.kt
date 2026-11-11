/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The exit survey and the win-back offer, RENDERED (paycraft-paywall-analytics T13).
 *
 * These replace the paywall body in place when a buyer closes without buying, so they are what a
 * leaving buyer sees last. ASSERT BEFORE CAPTURE per PaywallStateMatrixTest: a blank render makes a
 * perfectly stable golden.
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.survey.ExitSurveyContent
import com.mobilebytelabs.paycraft.ui.survey.ExitSurveyMessageContent
import com.mobilebytelabs.paycraft.ui.survey.WinbackOfferContent
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import com.mobilebytelabs.paycraft.winback.WinbackOffer
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class ExitSurveyScreenshotTest {

    private val cfg = ExitSurveyConfig(
        enabled = true, title = "Before you go — what stopped you?", capDays = 7,
        reasons = listOf(
            ExitSurveyConfig.Reason("too_expensive", "It's too expensive", "offer", offer = ExitSurveyConfig.Offer(50)),
            ExitSurveyConfig.Reason("payment_method", "My payment method isn't listed", "message", message = "We accept UPI on our website."),
            ExitSurveyConfig.Reason("not_sure", "I'm not sure it's worth it yet", "none"),
            ExitSurveyConfig.Reason("just_looking", "I'm just looking", "none"),
            ExitSurveyConfig.Reason("other", "Something else", "none", freeText = true),
        ),
    )
    private val offer = WinbackOffer(
        id = "o1", percentOff = 50, duration = "repeating", durationInMonths = 3, expiresAtIso = EXPIRES,
        sku = "pro-monthly", stripe = true, razorpay = true, googlePlayOfferId = null, appStoreOffer = null,
    )
    private val plan = BillingPlan(id = "pro-monthly", name = "Pro Monthly", price = "₹299", interval = "/month", rank = 1)

    @Test
    fun survey_lists_the_tenant_reasons() = runComposeUiTest {
        setContent { Harness { ExitSurveyContent(cfg, sending = false, onAnswer = { _, _ -> }, onSkip = {}) } }
        onNodeWithText("Before you go — what stopped you?").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.exitReason("just_looking")).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.EXIT_SURVEY_SKIP).assertIsDisplayed()
        onRoot().captureRoboImage(P_SURVEY)
        assertCaptured(P_SURVEY)
    }

    @Test
    fun survey_other_expands_a_free_text_field() = runComposeUiTest {
        setContent { Harness { ExitSurveyContent(cfg, sending = false, onAnswer = { _, _ -> }, onSkip = {}) } }
        onNodeWithTag(PayCraftTestTags.exitReason("other")).performClick()
        waitForIdle()
        onNodeWithTag(PayCraftTestTags.EXIT_SURVEY_OTHER_FIELD).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.EXIT_SURVEY_SEND).assertIsDisplayed()
        onRoot().captureRoboImage(P_SURVEY_OTHER)
        assertCaptured(P_SURVEY_OTHER)
    }

    @Test
    fun winback_offer_shows_the_discount_and_its_terms() = runComposeUiTest {
        setContent { Harness { WinbackOfferContent(offer, plan, onClaim = {}, onDecline = {}, now = { NOW }) } }
        onNodeWithText("50% off").assertIsDisplayed()
        onNodeWithText("50% off for 3 months").assertIsDisplayed()
        onNodeWithText("Ends in 47:59").assertIsDisplayed()
        onNodeWithText("₹149.50", substring = true).assertIsDisplayed()
        onNodeWithText("Claim 50% off").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.WINBACK_DECLINE).assertIsDisplayed()
        onRoot().captureRoboImage(P_OFFER)
        assertCaptured(P_OFFER)
    }

    @Test
    fun message_answer_shows_the_tenant_message() = runComposeUiTest {
        setContent { Harness { ExitSurveyMessageContent("We accept UPI on our website.", onBack = {}, onClose = {}) } }
        onNodeWithText("We accept UPI on our website.").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.EXIT_SURVEY_BACK).assertIsDisplayed()
        onRoot().captureRoboImage(P_MESSAGE)
        assertCaptured(P_MESSAGE)
    }

    @Composable
    private fun Harness(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(Modifier.size(width = 411.dp, height = 640.dp).background(MaterialTheme.colorScheme.surface)) {
                PayCraftThemeProvider { content() }
            }
        }
    }

    private fun assertCaptured(path: String) {
        val f = java.io.File(path)
        assertTrue(f.exists() && f.length() > 0L, "captureRoboImage did not write $path — verifyRoborazziJvm would be vacuously green")
    }

    private companion object {
        const val EXPIRES = "2026-11-12T10:00:00Z"
        val NOW = kotlin.time.Instant.parse(EXPIRES).toEpochMilliseconds() - (47 * 60 + 59) * 60_000L - 30_000
        const val DIR = "src/jvmTest/resources/screenshots"
        const val P_SURVEY = "$DIR/exit_survey_reasons.png"
        const val P_SURVEY_OTHER = "$DIR/exit_survey_other_expanded.png"
        const val P_OFFER = "$DIR/winback_offer.png"
        const val P_MESSAGE = "$DIR/exit_survey_message.png"
    }
}
