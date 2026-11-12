package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The web exit survey (paycraft-paywall-analytics AC-8, T14 Designed UX): the tenant's question with a radio per
 * reason and Send held until one is picked, a free-text field only on the reason that asks for it, the offer card
 * (percent, terms, price before → after, the clock, Claim / No thanks), the message state — all escaped — and that
 * nothing is shown when the SDK says the survey is not due.
 */
class ExitSurveyDialogTest {

    private fun survey(json: String) = js("JSON.parse(json)").unsafeCast<WebExitSurveyView>()

    @Test
    fun the_survey_asks_the_tenant_question_with_a_radio_per_reason() {
        val html = surveyHtml(
            survey(
                """{"title":"Before you go — what stopped you?","reasons":[
                   {"code":"too_expensive","label":"It's too expensive","freeText":false},
                   {"code":"other","label":"Something else","freeText":true}]}""",
            ),
        )
        assertTrue("Before you go — what stopped you?" in html)
        assertEquals(2, Regex("""type="radio" name="pcx-s-r"""").findAll(html).count())
        assertTrue("""value="too_expensive"""" in html && "It&#39;s too expensive" in html)
        assertEquals(1, Regex("<textarea").findAll(html).count(), "only 'Something else' has a text field")
        assertTrue("""data-pcx-s-text="other"""" in html && """maxlength="500"""" in html)
        assertTrue(
            Regex("""data-pcx-s="send" data-pcx-s-send disabled""").containsMatchIn(html),
            "Send waits for a reason",
        )
        assertTrue("""data-pcx-s="skip"""" in html && """aria-label="Close"""" in html)
    }

    @Test
    fun the_offer_shows_the_discount_its_terms_the_price_and_the_clock() {
        val product = js("JSON.parse")(
            """{"sku":"pro-monthly","name":"Pro Monthly","interval":"month","amountCents":29900,"currency":"INR","trialDays":null}""",
        ).unsafeCast<WebProductView>()
        val html = offerHtml(offer(50, "once"), product, "47:59")
        assertTrue("50% off</p>" in html)
        assertTrue("50% off your first payment" in html)
        assertTrue(
            Regex("<s class=\"pcx-s-was\">[^<]*299</s> <strong>[^<]*149\\.50</strong>").containsMatchIn(html),
            html,
        )
        assertTrue("Ends in 47:59" in html)
        assertTrue("""data-pcx-s="claim" data-offer="o1">Claim 50% off""" in html)
        assertTrue("No thanks" in html)
        assertTrue("for 3 months" in offerHtml(offer(20, "repeating", 3), null, null))
        assertFalse("Ends in" in offerHtml(offer(20, "forever"), null, null), "no clock once expired")
    }

    @Test
    fun the_message_state_is_escaped_and_leads_back_to_checkout() {
        val html = messageHtml("<b>UPI</b> on our website")
        assertFalse("<b>" in html)
        assertTrue("&lt;b&gt;UPI" in html && "Back to checkout" in html)
    }

    @Test
    fun the_clock_reads_hours_and_minutes_then_days() {
        val end = "2026-11-12T10:00:00Z"
        val at = js("Date.parse")(end).unsafeCast<Double>()
        assertEquals("47:59", offerTimeLeft(end, at - (47 * 60 + 59) * 60_000.0 - 30_000))
        assertEquals("5d", offerTimeLeft(end, at - 120 * 3_600_000.0))
        assertNull(offerTimeLeft(end, at))
        assertNull(offerTimeLeft("not a date", 0.0))
    }

    @Test
    fun nothing_is_shown_when_the_survey_is_not_due(): Promise<*> {
        val pc: dynamic = fakePc().asDynamic()
        var shown = false
        pc.surveyConfig = { Promise.resolve<Any?>(null) }
        pc.surveyShown = { _: String, _: String? -> shown = true }
        return showExitSurvey(pc, "provider", "pro-monthly").then { outcome ->
            assertEquals("none", outcome)
            assertFalse(shown, "a survey that is not due is never marked shown")
        }
    }
}
