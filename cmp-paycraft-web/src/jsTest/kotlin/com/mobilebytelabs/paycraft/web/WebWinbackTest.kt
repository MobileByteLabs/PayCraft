package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.await
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The web half of the exit survey + win-back (paycraft-paywall-analytics AC-8 / AC-9 on the web): the survey is
 * offered only when due (tenant on, not premium, outside its cap on this browser), an answer is recorded and turned
 * into what the tenant gives for it, a claimed offer rides into checkout — through checkout-initiate even where the
 * buyer would otherwise get a fixed-price Stripe link — and a stale offer never blocks a purchase. The checkout
 * page's steps reach the catalog through `checkoutEvent`, so the lazy UI module never names an event.
 */
class WebWinbackTest {
    private val backend = "https://example.supabase.co"
    private var clock = 1_000_000.0

    private fun sdk(net: FakeTransport): PayCraftWeb = PayCraftWeb("pk_test_abc", null, backend, "anon-key").also {
        it.transport = net
        it.store = TokenStore(MemoryKeyValue())
        it.now = { clock }
        it.newDeviceId = { "dev-web-1" }
        it.deviceName = { "Chrome on Mac" }
        it.currentPage = { "https://site.example/checkout/?plan=pro-monthly" }
    }

    private fun net(config: String = SURVEY_CONFIG) = FakeTransport()
        .on("/functions/v1/identity-token/verify") { """{"email":"a@x.com","provider":"google"}""" }
        .on("/rest/v1/rpc/register_device") { """{"server_token":"srv_1","conflict":false}""" }
        .on("/functions/v1/config") { config }
        .on("/functions/v1/events") { """{"accepted":1}""" }

    @Test fun the_survey_is_offered_only_when_due() = runTest {
        val pc = sdk(net())
        val s = assertNotNull(pc.surveyConfig().await(), "on, not premium, never shown")
        assertEquals("Before you go — what stopped you?", s.title)
        assertEquals(listOf("too_expensive", "other"), s.reasons.map { it.code })
        assertTrue(s.reasons[1].freeText)

        pc.surveyShown("provider", "pro-monthly")
        assertNull(pc.surveyConfig().await(), "inside its 7-day cap")
        clock += 7 * 86_400_000.0
        assertNotNull(pc.surveyConfig().await(), "cap passed")

        assertNull(sdk(net(NO_SURVEY_CONFIG)).surveyConfig().await(), "tenant has no survey")
    }

    @Test fun an_answer_is_recorded_and_earns_the_tenants_offer() = runTest {
        val n = net().on("/functions/v1/winback") { OFFER_ANSWER }
        val pc = sdk(n)
        val seen = mutableListOf<String>()
        pc.onEvent { name, _ -> seen += name }
        pc.config().await()
        pc.surveyShown("provider", "pro-monthly")
        val w = pc.answerSurvey("too_expensive", "provider", "pro-monthly", "ignored for this reason").await()
        assertEquals("offer", w.action)
        assertEquals(50, w.offer?.percentOff)
        assertEquals("2099-01-01T00:00:00Z", w.offer?.expiresAt)
        val body = n.bodyOf("/functions/v1/winback")
        assertEquals("too_expensive", body["reasonCode"]!!.jsonPrimitive.content)
        assertEquals("provider", body["step"]!!.jsonPrimitive.content)
        assertEquals("web", body["platform"]!!.jsonPrimitive.content)
        assertEquals("test", body["mode"]!!.jsonPrimitive.content)
        assertNull(body["email"], "the buyer is identified server-side, never by email in the body")
        assertEquals(listOf("paycraft_survey_view", "paycraft_survey_answer", "paycraft_offer_view"), seen)
    }

    @Test fun an_offer_no_web_lane_can_apply_and_a_failed_call_are_both_none() = runTest {
        val storeOnly = sdk(net().on("/functions/v1/winback") { STORE_ONLY_ANSWER })
        assertEquals("none", storeOnly.answerSurvey("too_expensive", "provider", "pro-monthly", null).await().action)
        val down = sdk(net().on("/functions/v1/winback", status = 500) { """{"error":"boom"}""" })
        assertEquals("none", down.answerSurvey("too_expensive", "provider", "pro-monthly", null).await().action)
        val msg = sdk(net().on("/functions/v1/winback") { """{"action":"message","message":"UPI on the website"}""" })
        assertEquals("UPI on the website", msg.answerSurvey("payment_method", "provider", null, null).await().message)
    }

    @Test fun a_claimed_offer_rides_into_razorpay_checkout() = runTest {
        val n = net().on("/functions/v1/winback") { OFFER_ANSWER }
            .on("/functions/v1/checkout-initiate") { """{"url":"https://rzp.io/i/sub_1"}""" }
        val pc = sdk(n)
        pc.doSignIn("google", "t", null)
        val offer = pc.answerSurvey("too_expensive", "provider", "pro-monthly", null).await().offer!!
        assertFalse(pc.claimOffer("someone-elses-offer"), "only the offer this page was given")
        assertTrue(pc.claimOffer(offer.id))
        assertEquals("o1", pc.activeOffer()?.id)
        assertEquals("https://rzp.io/i/sub_1", pc.checkoutUrlWith("pro-monthly", null, "razorpay").await())
        val body = n.bodyOf("/functions/v1/checkout-initiate")
        assertEquals("o1", body["offerId"]!!.jsonPrimitive.content)
        assertEquals("dev-web-1", body["deviceRef"]!!.jsonPrimitive.content)
    }

    @Test fun with_an_offer_stripe_uses_a_discounted_session_instead_of_the_fixed_price_link() = runTest {
        val n = net().on("/functions/v1/winback") { OFFER_ANSWER }
            .on("/functions/v1/checkout-initiate") { """{"url":"https://checkout.stripe.com/c/pay/cs_1"}""" }
        val pc = sdk(n)
        pc.doSignIn("google", "t", null)
        assertTrue(pc.checkoutUrlWith("pro-monthly", null, "stripe").await().startsWith("https://buy.stripe.com/"), "no offer: the link")
        pc.claimOffer(pc.answerSurvey("too_expensive", "provider", "pro-monthly", null).await().offer!!.id)
        assertEquals("https://checkout.stripe.com/c/pay/cs_1", pc.checkoutUrlWith("pro-monthly", null, "stripe").await())
        val body = n.bodyOf("/functions/v1/checkout-initiate")
        assertEquals("stripe", body["provider"]!!.jsonPrimitive.content)
        assertEquals("o1", body["offerId"]!!.jsonPrimitive.content)
    }

    @Test fun an_offer_the_server_no_longer_accepts_never_blocks_the_purchase() = runTest {
        val n = net().on("/functions/v1/winback") { OFFER_ANSWER }
            .onSequence("/functions/v1/checkout-initiate", 409 to """{"error":"offer_not_usable"}""", 200 to """{"url":"https://rzp.io/i/sub_2"}""")
        val pc = sdk(n)
        pc.doSignIn("google", "t", null)
        pc.claimOffer(pc.answerSurvey("too_expensive", "provider", "pro-monthly", null).await().offer!!.id)
        assertEquals("https://rzp.io/i/sub_2", pc.checkoutUrlWith("pro-monthly", null, "razorpay").await())
        val initiates = n.calls.filter { it.url.contains("checkout-initiate") }
        assertEquals(2, initiates.size, "refused with the offer, then the normal price")
        assertTrue("offerId" in initiates[0].body!! && "offerId" !in initiates[1].body!!)
        assertNull(pc.activeOffer(), "the stale offer is dropped")
    }

    @Test fun checkout_page_steps_become_catalog_events() {
        val pc = sdk(net())
        val seen = mutableListOf<Pair<String, String>>()
        pc.onEvent { name, p -> seen += name to (p.step as String) }
        for (kind in listOf("view", "select", "start", "fail", "abandon", "leave", "made-up")) {
            pc.checkoutEvent(kind, "pro-monthly", "INR", "stripe", if (kind == "fail") "network_error" else null)
        }
        assertEquals(
            listOf(
                "paycraft_provider_view" to "provider",
                "paycraft_provider_select" to "provider",
                "paycraft_checkout_start" to "checkout",
                "paycraft_purchase_fail" to "checkout",
                "paycraft_step_abandon" to "provider",
            ),
            seen,
        )
    }

    private companion object {
        val SURVEY_CONFIG = """
            {"tenant_id":"t1","products":[{"id":"p1","sku":"pro-monthly","type":"subscription","display_name":"Pro Monthly",
               "interval":"month","base_price_cents":29900,"base_currency":"INR",
               "resolved_price":{"amount_cents":29900,"currency":"INR","source":"manual"},
               "razorpay_plan_id_by_currency_test":{"INR":"plan_t_inr"}}],
             "providers":[{"provider":"razorpay"},
                          {"provider":"stripe","test_payment_links":{"pro-monthly":{"INR":"https://buy.stripe.com/test_inr"}}}],
             "exit_survey":{"enabled":true,"title":"Before you go — what stopped you?","cap_days":7,
               "reasons":[{"code":"too_expensive","label":"It's too expensive","action":"offer","offer":{"percent_off":50}},
                          {"code":"other","label":"Something else","action":"none","free_text":true}]}}
        """.trimIndent()
        val NO_SURVEY_CONFIG = """{"tenant_id":"t1","products":[],"providers":[]}"""
        val OFFER_ANSWER = """
            {"action":"offer","offer":{"id":"o1","percentOff":50,"duration":"once","expiresAt":"2099-01-01T00:00:00Z",
             "lanes":{"stripe":true,"razorpay":true,"google_play":null,"app_store":null}}}
        """.trimIndent()
        val STORE_ONLY_ANSWER = """
            {"action":"offer","offer":{"id":"o2","percentOff":50,"duration":"once","expiresAt":"2099-01-01T00:00:00Z",
             "lanes":{"stripe":false,"razorpay":false,"google_play":"winback-50","app_store":null}}}
        """.trimIndent()
    }
}
