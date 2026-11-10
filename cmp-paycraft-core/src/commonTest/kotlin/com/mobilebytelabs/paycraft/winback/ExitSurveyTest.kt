package com.mobilebytelabs.paycraft.winback

import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * When the exit survey may be shown (paycraft-paywall-analytics AC-7): only when the tenant has it on, the
 * buyer is not premium, there is something to ask, and the cap window since it was last shown has passed —
 * remembered on the device, so it survives app restarts. Plus the `/config` shape the SDKs read it from.
 */
class ExitSurveyTest {

    private val day = 86_400_000L
    private val cfg = ExitSurveyConfig(
        enabled = true, title = "Before you go — what stopped you?", capDays = 7,
        reasons = listOf(
            ExitSurveyConfig.Reason("too_expensive", "It's too expensive", "offer", offer = ExitSurveyConfig.Offer(percentOff = 50)),
            ExitSurveyConfig.Reason("other", "Something else", "none", freeText = true),
        ),
    )

    private fun gate(now: Long, settings: MapSettings = MapSettings()) = ExitSurveyGate(settings, now = { now })

    @Test fun shown_when_enabled_not_premium_and_never_shown() {
        assertTrue(gate(now = 100 * day).shouldShow(cfg, isPremium = false))
    }

    @Test fun never_shown_when_off_premium_empty_or_missing() {
        val g = gate(now = 100 * day)
        assertFalse(g.shouldShow(cfg.copy(enabled = false), isPremium = false))
        assertFalse(g.shouldShow(cfg, isPremium = true))
        assertFalse(g.shouldShow(cfg.copy(reasons = emptyList()), isPremium = false))
        assertFalse(g.shouldShow(null, isPremium = false))
    }

    @Test fun not_again_inside_the_cap_window_and_again_after_it() {
        val store = MapSettings()
        gate(now = 100 * day, settings = store).markShown()
        assertFalse(gate(now = 103 * day, settings = store).shouldShow(cfg, isPremium = false), "3 days later, cap 7")
        assertTrue(gate(now = 107 * day, settings = store).shouldShow(cfg, isPremium = false), "7 days later")
    }

    @Test fun decodes_the_config_section_and_tolerates_its_absence() {
        val raw = """
            {"tenant_id":"t","products":[],"exit_survey":{"enabled":true,"title":"Why not?","cap_days":3,
             "reasons":[{"code":"too_expensive","label":"Too expensive","action":"offer","offer":{"percent_off":50,"duration":"once"}},
                        {"code":"payment_method","label":"No UPI","action":"message","message":"We take UPI on the website."},
                        {"code":"other","label":"Other","action":"none","free_text":true}]}}
        """.trimIndent()
        val c = PayCraftContract.decodeExitSurvey(raw)!!
        assertEquals("Why not?", c.title)
        assertEquals(3, c.capDays)
        assertEquals(50, c.reasons[0].offer?.percentOff)
        assertEquals("We take UPI on the website.", c.reasons[1].message)
        assertTrue(c.reasons[2].freeText)
        assertNull(PayCraftContract.decodeExitSurvey("""{"tenant_id":"t"}"""))
        assertNull(PayCraftContract.decodeExitSurvey("""{"exit_survey":{"enabled":"yes?"}}"""), "malformed → no survey, never a crash")
    }

    @Test fun the_winback_body_carries_the_answer_without_personal_data() {
        val b = PayCraftContract.winbackBody("pk_x", deviceRef = "dev", deviceToken = "srv", reasonCode = "too_expensive",
            step = "checkout", platform = "android", sku = "pro-monthly", freeText = null)
        assertEquals("too_expensive", b["reasonCode"].toString().trim('"'))
        assertEquals("checkout", b["step"].toString().trim('"'))
        assertNull(b["email"])
    }
}
