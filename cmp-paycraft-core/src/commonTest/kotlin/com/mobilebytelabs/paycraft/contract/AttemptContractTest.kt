package com.mobilebytelabs.paycraft.contract

import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftFailure
import com.mobilebytelabs.paycraft.analytics.PayCraftFailureStage
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The attempt id on the wire, in exactly the shape sub-plan 02's server reads (paycraft-attempt-observability D5,
 * AC-9): `attempt_id` in checkout-initiate, register-play-purchase and register-appstore bodies; per event in
 * `events[]`, with a failure as `failure {stage, error_class, error_code, error_message}` — and a failure never sent
 * without the attempt the server must file it under.
 */
class AttemptContractTest {
    private val attempt = "1764000000000-00ab12cd34ef5678"

    @Test fun checkout_initiate_carries_the_attempt_beside_the_existing_fields() {
        val body = PayCraftContract.checkoutInitiateBody(
            sku = "pro-monthly",
            email = "buyer@example.com",
            attemptId = attempt,
            name = null,
            phone = null,
            currency = "INR",
            provider = null,
            returnUrl = null,
            offerId = "offer-1",
            deviceRef = "dev-1",
        )
        assertEquals(attempt, body["attempt_id"]!!.jsonPrimitive.content)
        assertEquals("pro-monthly", body["sku"]!!.jsonPrimitive.content)
        assertEquals("buyer@example.com", body["customer"]!!.jsonObject["email"]!!.jsonPrimitive.content)
        assertEquals("INR", body["currency"]!!.jsonPrimitive.content)
        assertEquals("offer-1", body["offerId"]!!.jsonPrimitive.content)
        assertNull(body["provider"], "the server's default lane unless one is named")
        val noAttempt = PayCraftContract.checkoutInitiateBody(
            "pro-monthly", "b@x.co", null, null, null, null, null, null, null, null,
        )
        // An SDK with no attempt sends none (the server treats it as optional).
        assertNull(noAttempt["attempt_id"])
    }

    @Test fun store_registrations_carry_the_attempt() {
        val play = PayCraftContract.registerPlayPurchaseBody("tok", "pro_monthly", "user", "com.app", "pk_x", attempt)
        assertEquals(attempt, play["attempt_id"]!!.jsonPrimitive.content)
        assertEquals("tok", play["purchase_token"]!!.jsonPrimitive.content)
        assertEquals("com.app", play["package_name"]!!.jsonPrimitive.content)
        val apple = PayCraftContract.registerAppStoreBody("jws", "user", "pro.monthly", "pk_x", attempt)
        assertEquals(attempt, apple["attempt_id"]!!.jsonPrimitive.content)
        assertEquals("jws", apple["signed_transaction"]!!.jsonPrimitive.content)
        assertNull(PayCraftContract.registerAppStoreBody("jws", "user", "p", null, null)["attempt_id"])
    }

    @Test fun events_carry_the_attempt_and_a_nested_failure() {
        val failure =
            PayCraftFailure(PayCraftFailureStage.Provider, "store_connect", "connect_6", "Service unavailable")
        val e = PayCraftEvent(
            name = PayCraftEventName.PurchaseFail,
            step = PayCraftStep.Checkout,
            platform = "android",
            atMs = 42,
            attemptId = attempt,
            failure = failure,
        )
        val wire = PayCraftContract.eventsBody("pk_x", "dev-1", null, listOf(e))["events"]!!.jsonArray[0].jsonObject
        assertEquals(attempt, wire["attempt_id"]!!.jsonPrimitive.content)
        val f = wire["failure"]!!.jsonObject
        assertEquals("provider", f["stage"]!!.jsonPrimitive.content)
        assertEquals("store_connect", f["error_class"]!!.jsonPrimitive.content)
        assertEquals("connect_6", f["error_code"]!!.jsonPrimitive.content)
        assertEquals("Service unavailable", f["error_message"]!!.jsonPrimitive.content)
    }

    @Test fun a_failure_without_an_attempt_is_not_sent_so_the_batch_is_not_refused() {
        val orphan = PayCraftEvent(
            name = PayCraftEventName.PurchaseFail,
            step = PayCraftStep.Checkout,
            platform = "web",
            atMs = 1,
            failure = PayCraftFailure(PayCraftFailureStage.Sdk, "transport", "transport_502"),
        )
        val wire = PayCraftContract.eventsBody(
            "pk_x",
            "dev-1",
            null,
            listOf(orphan),
        )["events"]!!.jsonArray[0].jsonObject
        assertNull(wire["failure"])
        assertNull(wire["attempt_id"])
    }
}
