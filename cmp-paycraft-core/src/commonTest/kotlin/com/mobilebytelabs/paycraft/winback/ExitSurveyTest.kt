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
        enabled = true,
        title = "Before you go — what stopped you?",
        capDays = 7,
        reasons = listOf(
            ExitSurveyConfig.Reason(
                "too_expensive",
                "It's too expensive",
                "offer",
                offer = ExitSurveyConfig.Offer(percentOff = 50),
            ),
            ExitSurveyConfig.Reason("other", "Something else", "none", freeText = true),
        ),
    )

    private fun gate(now: Long, settings: MapSettings = MapSettings()) = ExitSurveyGate(settings, now = { now })

    @Test fun shown_when_enabled_not_premium_and_never_shown() {
        assertTrue(gate(now = 100 * day).shouldShow(cfg, isPremium = false))
    }

    @Test fun never_shown_when_off_premium_empty_or_missing() {
        val g = gate(now = 100 * day)
        assertFalse(
            g.shouldShow(
                ExitSurveyConfig(enabled = false, title = cfg.title, reasons = cfg.reasons, capDays = 7),
                isPremium = false,
            ),
        )
        assertFalse(g.shouldShow(cfg, isPremium = true))
        assertFalse(
            g.shouldShow(
                ExitSurveyConfig(enabled = true, title = cfg.title, reasons = emptyList(), capDays = 7),
                isPremium = false,
            ),
        )
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
        assertNull(
            PayCraftContract.decodeExitSurvey("""{"exit_survey":{"enabled":"yes?"}}"""),
            "malformed → no survey, never a crash",
        )
    }

    @Test fun decodes_every_winback_answer_shape() {
        val offer = PayCraftContract.decodeWinback(
            """{"action":"offer","offer":{"id":"o1","percentOff":50,"duration":"once","expiresAt":"2026-11-13T10:00:00Z",
               "lanes":{"stripe":true,"razorpay":false,"google_play":"winback-50",
                        "app_store":{"offerId":"wb50","keyIdentifier":"K","nonce":"n","signature":"c2ln","timestamp":1799}}}}""",
            sku = "pro-monthly",
        ) as WinbackResult.Offer
        assertEquals("o1", offer.offer.id)
        assertEquals(50, offer.offer.percentOff)
        assertEquals("pro-monthly", offer.offer.sku)
        assertTrue(offer.offer.stripe)
        assertFalse(offer.offer.razorpay)
        assertEquals("winback-50", offer.offer.googlePlayOfferId)
        assertEquals("wb50", offer.offer.appStoreOffer?.offerId)
        assertEquals(1799L, offer.offer.appStoreOffer?.timestamp)
        assertEquals(
            "UPI on the web",
            (
                PayCraftContract.decodeWinback(
                    """{"action":"message","message":"UPI on the web"}""",
                    null,
                ) as WinbackResult.Message
                ).text,
        )
        assertEquals(WinbackResult.None, PayCraftContract.decodeWinback("""{"action":"none"}""", null))
        assertEquals(WinbackResult.None, PayCraftContract.decodeWinback("not json", null))
        val noStoreLanes = PayCraftContract.decodeWinback(
            """{"action":"offer","offer":{"id":"o2","percentOff":20,"expiresAt":"x","lanes":{"stripe":true,"razorpay":true,"google_play":null,"app_store":null}}}""",
            null,
        ) as WinbackResult.Offer
        assertNull(noStoreLanes.offer.googlePlayOfferId)
        assertNull(noStoreLanes.offer.appStoreOffer)
    }

    @Test fun the_web_decode_is_the_same_answer_without_the_app_store_lane() {
        val raw = """{"action":"offer","offer":{"id":"o1","percentOff":50,"expiresAt":"x","lanes":{"stripe":true,"razorpay":false,
            "google_play":"winback-50","app_store":{"offerId":"wb50","keyIdentifier":"K","nonce":"n","signature":"c2ln","timestamp":1}}}}"""
        val web = (PayCraftContract.decodeWinbackForWeb(raw, "pro-monthly") as WinbackResult.Offer).offer
        assertEquals("o1", web.id)
        assertTrue(web.stripe)
        assertNull(web.appStoreOffer, "a website cannot apply an App Store offer")
        assertEquals(
            "wb50",
            (PayCraftContract.decodeWinback(raw, "pro-monthly") as WinbackResult.Offer).offer.appStoreOffer?.offerId,
        )
    }

    @Test fun the_app_account_token_is_a_stable_uuid() {
        val t = com.mobilebytelabs.paycraft.billing.storeAppAccountToken("buyer@example.com")
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(t), t)
        assertEquals(t, com.mobilebytelabs.paycraft.billing.storeAppAccountToken("buyer@example.com"))
    }

    @Test fun the_winback_body_carries_the_answer_without_personal_data() {
        val b = PayCraftContract.winbackBody(
            "pk_x",
            deviceRef = "dev",
            deviceToken = "srv",
            reasonCode = "too_expensive",
            step = "checkout",
            platform = "android",
            sku = "pro-monthly",
            freeText = null,
        )
        assertEquals("too_expensive", b["reasonCode"].toString().trim('"'))
        assertEquals("checkout", b["step"].toString().trim('"'))
        assertNull(b["email"])
    }
}
