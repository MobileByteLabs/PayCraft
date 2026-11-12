// Event fixtures read as one call per line; wrapping them hides which field a case is about.
@file:Suppress("ktlint:standard:max-line-length")

package com.mobilebytelabs.paycraft.analytics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The event catalog is what every SDK emits and what the app forwards to GA4, so each name must be a valid
 * GA4 event name: ≤ 40 characters, snake_case, not reserved, and carrying PayCraft's prefix so it never
 * collides with an app's own events. Params stay inside GA4's 25-per-event limit.
 */
class PayCraftEventCatalogTest {

    private val reservedPrefixes = listOf("firebase_", "google_", "ga_")
    private val reservedNames = setOf("first_open", "session_start", "user_engagement", "app_remove", "screen_view")

    @Test fun every_name_is_a_valid_prefixed_ga4_event_name() {
        PayCraftEventName.entries.forEach { e ->
            assertTrue(Regex("^paycraft_[a-z][a-z_]*$").matches(e.wire), "not snake_case with prefix: ${e.wire}")
            assertTrue(e.wire.length <= 40, "longer than 40 chars: ${e.wire}")
            assertTrue(
                e.wire !in reservedNames &&
                    reservedPrefixes.none {
                        e.wire.startsWith(it)
                    },
                "reserved: ${e.wire}",
            )
        }
    }

    @Test fun names_and_steps_are_unique() {
        assertEquals(PayCraftEventName.entries.size, PayCraftEventName.entries.map { it.wire }.toSet().size)
        assertEquals(PayCraftStep.entries.size, PayCraftStep.entries.map { it.wire }.toSet().size)
    }

    @Test fun params_carry_only_what_is_set_and_stay_within_ga4_limits() {
        val bare = PayCraftEvent(PayCraftEventName.PaywallView, PayCraftStep.Paywall, platform = "android", atMs = 1)
        assertEquals(mapOf("step" to "paywall", "platform" to "android"), bare.params())

        val full = PayCraftEvent(
            PayCraftEventName.StepAbandon, PayCraftStep.Checkout, platform = "web", trigger = "home",
            sku = "pro-monthly", currency = "INR", country = "IN", provider = "razorpay", reason = "too_expensive", atMs = 1,
        )
        val p = full.params()
        assertTrue(p.size <= 25)
        assertEquals("checkout", p["step"])
        assertEquals("razorpay", p["provider"])
        p.forEach { (k, v) ->
            assertTrue(k.length <= 40 && Regex("^[a-z][a-z_]*$").matches(k), "bad param name $k")
            assertTrue(v.length <= 100, "param $k longer than 100 chars")
        }
    }

    @Test fun long_values_are_cut_to_the_ga4_limit() {
        val e =
            PayCraftEvent(
                PayCraftEventName.PlanSelect,
                PayCraftStep.Plan,
                platform = "ios",
                sku = "x".repeat(150),
                atMs = 1,
            )
        assertEquals(100, e.params().getValue("sku").length)
    }
}
