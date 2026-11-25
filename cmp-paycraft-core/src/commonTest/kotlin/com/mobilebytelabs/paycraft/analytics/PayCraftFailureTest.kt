package com.mobilebytelabs.paycraft.analytics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * One failure shape for every layer (paycraft-attempt-observability GOAL D6, AC-10, AC-19): a stage from a closed
 * set, a groupable class and code, and a message that is safe to store — no email, phone, card number or key, and
 * never more than 200 characters.
 */
class PayCraftFailureTest {

    @Test fun stages_are_the_five_declared_in_goal_d6() {
        assertEquals(
            setOf("sdk", "server", "provider", "webhook", "entitlement"),
            PayCraftFailureStage.entries.map { it.wire }.toSet(),
        )
    }

    @Test fun message_truncated_at_200_chars() {
        val f = PayCraftFailure(PayCraftFailureStage.Provider, "launch_failed", "launch_6", "x".repeat(400))
        assertEquals(200, f.message.length)
    }

    @Test fun email_and_phone_are_scrubbed_from_message() {
        val f = PayCraftFailure(
            PayCraftFailureStage.Sdk,
            "transport",
            "fetch",
            "user a@b.com phone +1-555-0199 timed out",
        )
        assertFalse(f.message.contains('@'), "email leak: ${f.message}")
        assertFalse(f.message.contains("+1-555"), "phone leak: ${f.message}")
        assertTrue(f.message.endsWith("timed out"), "the useful part survives: ${f.message}")
    }

    @Test fun card_numbers_and_keys_are_scrubbed_from_message() {
        val f = PayCraftFailure(
            PayCraftFailureStage.Server,
            "stripe_init",
            "card_declined",
            "card 4242 4242 4242 4242 declined for key sk_live_51Habcdef and token eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl",
        )
        assertFalse(f.message.contains("4242"), "card leak: ${f.message}")
        assertFalse(f.message.contains("sk_live"), "key leak: ${f.message}")
        assertFalse(f.message.contains("eyJ"), "jwt leak: ${f.message}")
    }

    @Test fun class_and_code_are_short_lowercase_slugs_like_the_server_stores() {
        val f = PayCraftFailure(PayCraftFailureStage.Provider, "Store Connect!", "CONNECT 6", "")
        assertEquals("store_connect", f.errorClass)
        assertEquals("connect_6", f.code)
        assertEquals("", f.message)
        assertEquals(
            "unknown",
            PayCraftFailure(PayCraftFailureStage.Sdk, "!!", "", "").errorClass,
            "never an empty slug",
        )
    }

    @Test fun an_event_carries_the_failure_onto_the_wire_and_only_its_codes_into_app_analytics() {
        val failure = PayCraftFailure(PayCraftFailureStage.Provider, "store_purchase", "purchase_6", "Item unavailable")
        val e = PayCraftEvent(
            name = PayCraftEventName.PurchaseFail,
            step = PayCraftStep.Checkout,
            platform = "android",
            atMs = 1,
            attemptId = "1700000000000-abc",
            failure = failure,
        )
        assertEquals("provider", e.stage)
        assertEquals("store_purchase", e.errorClass)
        assertEquals("purchase_6", e.code)
        val params = e.params()
        assertEquals("1700000000000-abc", params["attempt_id"])
        assertEquals("provider", params["stage"])
        assertEquals("store_purchase", params["error_class"])
        assertEquals("purchase_6", params["code"])
        // The message is first-party only (PayCraft's ingest); the app's GA4 gets the groupable codes.
        assertFalse(params.values.any { it.contains("unavailable") })
        assertNull(
            PayCraftEvent(PayCraftEventName.PaywallView, PayCraftStep.Paywall, "ios", atMs = 1).params()["stage"],
        )
    }
}
