package com.mobilebytelabs.paycraft.contract

import com.mobilebytelabs.paycraft.PayCraftInternalApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The wire contract both SDKs speak (paycraft-core-split). If one of these changes, the app SDK and
 * the browser SDK change together — that is the point of having one definition.
 */
@OptIn(PayCraftInternalApi::class)
class PayCraftContractTest {

    private fun config(providers: String, binding: String? = null, resolved: String = "INR"): String = """
        {"tenant_id":"t1","mode":"ad_supported",
         "products":[{"id":"p1","sku":"pro_monthly","type":"subscription","display_name":"Pro Monthly",
           "interval":"month","base_price_cents":999,"base_currency":"USD",
           "resolved_price":{"amount_cents":19900,"currency":"$resolved","source":"locale"}
           ${binding?.let { ""","store_binding":{"provider":"$it","product_id":"x"}""" } ?: ""}}],
         "providers":[$providers]}
    """.trimIndent()

    private fun route(raw: String, test: Boolean = false, currency: String? = null, email: String = "a+b@mail.test") =
        PayCraftContract.routeWebCheckout(PayCraftContract.decodeConfig(raw), "pro_monthly", test, currency, email)

    @Test
    fun the_provider_config_bound_for_the_buyers_currency_sells_through_a_server_checkout() {
        // /config priced the buyer in INR and bound the product to the provider that can charge INR
        val both = """{"provider":"stripe"},{"provider":"razorpay"}"""
        assertEquals(WebCheckoutRoute.ServerCheckout("INR", "razorpay"), route(config(both, binding = "razorpay")))
        // a payment-method suffix names the same provider: stripe_card → stripe, whatever the currency
        assertEquals(
            WebCheckoutRoute.ServerCheckout("USD", "stripe"),
            route(config(both, binding = "stripe_card", resolved = "USD")),
        )
        assertEquals(WebCheckoutRoute.ServerCheckout("INR", "stripe"), route(config(both, binding = "stripe_card")))
        // nothing in code prefers a provider per country: the bound one sells even if not listed first
        assertEquals(
            WebCheckoutRoute.ServerCheckout("EUR", "razorpay"),
            route(
                config("""{"provider":"stripe"},{"provider":"razorpay"}""", binding = "razorpay_upi", resolved = "EUR"),
            ),
        )
    }

    @Test
    fun stripe_link_for_the_mode_gets_the_email_prefilled_and_encoded() {
        val links = """{"provider":"stripe",
            "test_payment_links":{"pro_monthly":{"USD":"https://buy.stripe.com/test_x"}},
            "live_payment_links":{"pro_monthly":{"USD":"https://buy.stripe.com/live_x?ref=1"}}}"""
        assertEquals(
            WebCheckoutRoute.PaymentLink("stripe", "https://buy.stripe.com/test_x?prefilled_email=a%2Bb%40mail.test"),
            route(config(links), test = true),
        )
        // live link already has a query string → `&`; INR not linked → USD fallback
        assertEquals(
            WebCheckoutRoute.PaymentLink(
                "stripe",
                "https://buy.stripe.com/live_x?ref=1&prefilled_email=a%2Bb%40mail.test",
            ),
            route(config(links)),
        )
    }

    @Test
    fun the_bound_providers_link_beats_its_server_checkout_and_a_native_binding_never_decides() {
        val both = """{"provider":"razorpay","live_payment_links":{"pro_monthly":{"INR":"https://rzp.io/l/x"}}},""" +
            """{"provider":"stripe","live_payment_links":{"pro_monthly":{"INR":"https://s/l"}}}"""
        assertEquals(
            WebCheckoutRoute.PaymentLink("razorpay", "https://rzp.io/l/x"),
            route(config(both, binding = "razorpay")),
        )
        assertEquals(
            WebCheckoutRoute.PaymentLink("stripe", "https://s/l?prefilled_email=a%2Bb%40mail.test"),
            route(config(both, binding = "stripe_card")),
        )
        // a Play binding is not a web lane → the first provider with a link in INR sells
        assertEquals(
            WebCheckoutRoute.PaymentLink("razorpay", "https://rzp.io/l/x"),
            route(config(both, binding = "google_play")),
        )
    }

    @Test
    fun without_a_binding_a_link_in_the_buyers_currency_wins_over_one_in_another() {
        val providers = """{"provider":"stripe","live_payment_links":{"pro_monthly":{"USD":"https://s/usd"}}},""" +
            """{"provider":"razorpay","live_payment_links":{"pro_monthly":{"INR":"https://rzp.io/l/inr"}}}"""
        assertEquals(WebCheckoutRoute.PaymentLink("razorpay", "https://rzp.io/l/inr"), route(config(providers)))
        assertEquals(
            WebCheckoutRoute.PaymentLink("stripe", "https://s/usd?prefilled_email=a%2Bb%40mail.test"),
            route(config(providers, resolved = "USD")),
        )
    }

    @Test
    fun asking_for_another_currency_re_decides_instead_of_reusing_the_binding() {
        // bound to razorpay for INR, but the caller asks for USD: only a provider with a link can sell
        val both = """{"provider":"razorpay"},""" +
            """{"provider":"stripe","live_payment_links":{"pro_monthly":{"USD":"https://s/usd"}}}"""
        assertEquals(
            WebCheckoutRoute.PaymentLink("stripe", "https://s/usd?prefilled_email=a%2Bb%40mail.test"),
            route(config(both, binding = "razorpay"), currency = "USD"),
        )
        assertEquals(
            WebCheckoutRoute.ServerCheckout("INR", "razorpay"),
            route(config(both, binding = "razorpay"), currency = "inr"),
        )
    }

    @Test
    fun the_currencies_each_provider_can_charge_come_from_the_products_price_and_plan_maps() {
        val product = obj(
            """{"sku":"pro_monthly",
               "stripe_price_id_by_currency":{"USD":"price_usd","INR":"price_inr","GBP":""},
               "stripe_price_id_by_currency_test":{"USD":"price_test_usd"},
               "live_stripe_ids_verified":true,
               "razorpay_plan_id_by_currency":{"INR":"plan_inr"},
               "razorpay_plan_id_by_currency_test":{"INR":"plan_test_inr"}}""",
        )
        assertEquals(mapOf("stripe" to setOf("USD", "INR"), "razorpay" to setOf("INR")), PayCraftContract.chargeableCurrencies(product, test = false))
        assertEquals(mapOf("stripe" to setOf("USD"), "razorpay" to setOf("INR")), PayCraftContract.chargeableCurrencies(product, test = true))
        // live Stripe ids not verified by a live sync may hold TEST ids → not chargeable live
        val unverified = obj("""{"stripe_price_id_by_currency":{"USD":"price_usd"},"live_stripe_ids_verified":false}""")
        assertEquals(emptyMap(), PayCraftContract.chargeableCurrencies(unverified, test = false))
    }

    @Test
    fun a_currency_both_providers_can_charge_offers_both_bound_one_first_and_honours_the_choice() {
        val both = """{"provider":"stripe"},{"provider":"razorpay"}"""
        val cfg = PayCraftContract.decodeConfig(config(both, binding = "razorpay"))
        val chargeable = mapOf("stripe" to setOf("USD", "INR"), "razorpay" to setOf("INR"))
        assertEquals(listOf("razorpay", "stripe"), PayCraftContract.webPaymentOptions(cfg, "pro_monthly", false, null, chargeable))
        // USD: only Stripe can charge it → no choice to offer
        assertEquals(listOf("stripe"), PayCraftContract.webPaymentOptions(cfg, "pro_monthly", false, "USD", chargeable))
        // the buyer picked Stripe for the INR price → Stripe, in INR
        assertEquals(
            WebCheckoutRoute.ServerCheckout("INR", "stripe"),
            PayCraftContract.routeWebCheckout(cfg, "pro_monthly", false, null, "a@b.c", preferredProvider = "stripe", chargeable = chargeable),
        )
        // a choice that cannot charge this currency is ignored, never forced
        assertEquals(
            WebCheckoutRoute.ServerCheckout("USD", "stripe"),
            PayCraftContract.routeWebCheckout(cfg, "pro_monthly", false, "USD", "a@b.c", preferredProvider = "razorpay", chargeable = chargeable),
        )
    }

    @Test
    fun unavailable_routes_name_why() {
        // no binding (no provider can charge the currency) and no link → never a guessed provider
        assertEquals(
            WebCheckoutFailure.NoWebProvider,
            (route(config("""{"provider":"razorpay"},{"provider":"stripe"}""")) as WebCheckoutRoute.Unavailable).reason,
        )
        assertEquals(
            WebCheckoutFailure.NoWebProvider,
            (
                route(
                    config("""{"provider":"google_play"}""", binding = "google_play"),
                ) as WebCheckoutRoute.Unavailable
                ).reason,
        )
        val unknown = PayCraftContract.routeWebCheckout(
            PayCraftContract.decodeConfig(config("""{"provider":"razorpay"}""", binding = "razorpay")),
            "nope",
            false,
            null,
            "a@b.c",
        )
        assertEquals(WebCheckoutFailure.UnknownSku, (unknown as WebCheckoutRoute.Unavailable).reason)
    }

    @Test
    fun encoding_keeps_only_unreserved_characters() {
        assertEquals("a%2Bb%40x.com", PayCraftContract.encodeUrlComponent("a+b@x.com"))
        assertEquals("A-z_0.9~", PayCraftContract.encodeUrlComponent("A-z_0.9~"))
        assertEquals("%20%26%3D%C3%A9", PayCraftContract.encodeUrlComponent(" &=é"))
        assertEquals("https://x", PayCraftContract.withEmailParam("https://x", "e", null))
    }

    @Test
    fun device_rpc_params_and_parsers_round_trip() {
        assertEquals(
            """{"p_email":"e@x","p_platform":"web","p_device_name":"Chrome on Android","p_device_id":"d1","p_mode":"test","p_api_key":"pk"}""",
            PayCraftContract.registerDeviceParams("e@x", "web", "Chrome on Android", "d1", "test", "pk").toString(),
        )
        val reg = PayCraftContract.parseRegister(
            obj("""{"server_token":"srv","conflict":true,"conflicting_device_name":"Pixel 7"}"""),
        )!!
        assertEquals("srv", reg.deviceToken)
        assertEquals(true, reg.conflict)
        assertEquals("Pixel 7", reg.conflictingDeviceName)
        assertNull(PayCraftContract.parseRegister(obj("""{"conflict":false}""")))
        assertEquals("""{"p_server_token":"srv"}""", PayCraftContract.tokenParams("srv", null).toString())
        val premium = PayCraftContract.parsePremium(obj("""{"is_premium":true,"token_valid":true,"email":"e@x"}"""))
        assertEquals(true, premium.isPremium && premium.tokenValid)
        assertEquals("e@x", premium.boundEmail)
        assertEquals(true, PayCraftContract.parseTransferred(obj("""{"transferred":true}""")))
        assertEquals(
            """{"p_server_token":"a","p_new_device_token":"b","p_api_key":"pk"}""",
            PayCraftContract.transferParams("a", "b", "pk").toString(),
        )
    }

    @Test
    fun a_device_limit_conflict_lists_the_seats_and_the_chosen_one_is_sent() {
        val r = PayCraftContract.parseRegister(
            obj(
                """{"server_token":"srv_c","conflict":true,"conflicting_device_name":"Pixel 7","max_devices":2,
                 "active_devices":[
                   {"device_ref":"r1","device_name":"Pixel 7","platform":"android","last_seen_at":"2026-11-10T08:00:00Z"},
                   {"device_ref":"r2","device_name":null,"platform":"web","registered_at":"2026-11-09T08:00:00Z"},
                   {"device_name":"no ref is skipped","platform":"ios"}]}""",
            ),
        )!!
        assertEquals(2, r.maxDevices)
        assertEquals(listOf("r1", "r2"), r.activeDevices.map { it.ref })
        assertEquals("2026-11-09T08:00:00Z", r.activeDevices[1].lastSeen) // falls back to registered_at
        // an older server: no list, one device
        val legacy = PayCraftContract.parseRegister(obj("""{"server_token":"srv_x","conflict":true}"""))!!
        assertEquals(1, legacy.maxDevices)
        assertEquals(emptyList(), legacy.activeDevices)

        assertEquals(
            "r2",
            PayCraftContract.transferParams("srv_c", "srv_c", "pk", "r2")["p_replace_device"]?.jsonPrimitive?.content,
        )
        // never sent unless chosen — a pre-178 server has no such parameter
        assertNull(PayCraftContract.transferParams("srv_c", "srv_c", "pk")["p_replace_device"])
    }

    @Test
    fun identity_body_carries_the_raw_nonce_only_when_given() {
        assertEquals(
            """{"api_key":"pk","provider":"apple","id_token":"t","nonce":"raw"}""",
            PayCraftContract.identityVerifyBody("pk", "apple", "t", "raw").toString(),
        )
        assertEquals(
            """{"api_key":"pk","provider":"google","id_token":"t"}""",
            PayCraftContract.identityVerifyBody("pk", "google", "t", null).toString(),
        )
        assertNull(PayCraftContract.parseVerifiedEmail(obj("""{"email":" "}""")))
        assertEquals("v@x", PayCraftContract.parseVerifiedEmail(obj("""{"email":"v@x"}""")))
    }

    @Test
    fun headers_and_urls_are_the_ones_both_sdks_send() {
        assertEquals(
            mapOf(
                "apikey" to "anon",
                "Authorization" to "Bearer anon",
                "x-paycraft-platform" to "web",
                "x-paycraft-mode" to "test",
                "content-type" to "application/json",
            ),
            PayCraftContract.headers("anon", "web", "test", json = true),
        )
        assertEquals(
            "https://b/functions/v1/config?apiKey=pk_test_1",
            PayCraftContract.configUrl("https://b", "pk_test_1"),
        )
        assertEquals(
            "https://b/functions/v1/checkout-initiate?apiKey=pk",
            PayCraftContract.checkoutInitiateUrl("https://b", "pk"),
        )
        assertEquals("https://b/rest/v1/rpc/register_device", PayCraftContract.rpcUrl("https://b", "register_device"))
    }

    @Test
    fun web_decoding_survives_a_malformed_paywall_and_bad_products() {
        // The website has no config cache or bundled fallback: tenant-written paywall JSONB (value_props,
        // theme_jsonb) must not take products — and checkout — down with it.
        val raw = """
            {"products":[
               {"sku":"pro_monthly","display_name":"Pro","base_price_cents":999,"base_currency":"USD",
                "resolved_price":{"amount_cents":19900,"currency":"INR"}},
               {"sku":"broken","base_price_cents":"not-a-number"},
               {"id":"p3","sku":"pro_annual","type":"subscription","display_name":"Annual","base_price_cents":7999,
                "resolved_price":{"amount_cents":79900,"currency":"INR","source":"locale"}}],
             "providers":[{"provider":"razorpay"},{"not_a_provider":true}],
             "paywall":{"value_props":[{"nope":true}],"theme_jsonb":{"nested":{"x":1}}},
             "auth":{"google_web_client_id":"g.apps"},"mode":"ad_supported"}
        """.trimIndent()
        val cfg = PayCraftContract.decodeConfigForWeb(raw)
        assertEquals(listOf("pro_monthly", "pro_annual"), cfg.products.map { it.sku })
        val monthly = cfg.products.first()
        assertNull(monthly.resolvedPrice, "a malformed resolved_price drops to the base price")
        assertEquals(999, monthly.basePriceCents)
        assertEquals(79900, cfg.products[1].resolvedPrice?.amountCents)
        assertEquals(listOf("razorpay"), cfg.providers.map { it.provider })
        assertEquals("g.apps", cfg.auth?.googleWebClientId)
        assertEquals("", cfg.tenantId)
    }

    private fun obj(raw: String): JsonObject = Json.parseToJsonElement(raw).jsonObject
}
