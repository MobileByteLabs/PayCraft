package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.ui.components.humanBillingError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * A failure message on a payment surface is read by someone trying to give you money.
 *
 * cappy showed them "Product not found on Play: com.mobilebytesensei.cappy.sub.year" — a developer's
 * sentence, naming an internal id, with no action in it.
 */
class HumanBillingErrorTest {

    @Test
    fun a_missing_store_product_reads_as_a_plan_problem_not_an_app_crash() {
        assertEquals(
            "This plan isn't available right now. Try another plan, or check back soon.",
            humanBillingError("Product not found on Play: com.mobilebytesensei.cappy.sub.year"),
        )
    }

    /**
     * The strings below were copied from logcat on a physical device, not invented. The first
     * version of this mapping matched "not found" and missed "not configured" — so the real failure
     * still fell through to the generic line, which the device screenshot showed and the unit tests
     * did not.
     */
    @Test
    fun the_messages_a_real_device_actually_produced_are_recognised() {
        val unavailable = "This plan isn't available right now. Try another plan, or check back soon."
        assertEquals(
            unavailable,
            humanBillingError(
                "Google Play product not configured for plan c0fd8d93-6445-433d-8173-3e04538fe402 (native digital)",
            ),
        )
        assertEquals(
            unavailable,
            humanBillingError(
                "product id missing for c0fd8d93-6445-433d-8173-3e04538fe402 " +
                    "— refusing web fallback (store anti-steering)",
            ),
        )
        // And neither leaks the plan id at the customer.
        assertFalse(unavailable.contains("c0fd8d93"))
    }

    @Test
    fun the_common_cases_each_say_what_to_do_next() {
        assertEquals("Purchase cancelled.", humanBillingError("User cancelled the flow"))
        assertEquals(
            "We couldn't reach the store. Check your connection and try again.",
            humanBillingError("network timeout while contacting billing"),
        )
        assertEquals(
            "You already own this. Try Restore Purchases.",
            humanBillingError("Item already owned"),
        )
    }

    @Test
    fun an_unrecognised_failure_never_leaks_internals() {
        val leaky = "PGRST301 http://10.0.2.2:54321/rest/v1/rpc/register_device Bearer eyJhbGci"
        val shown = humanBillingError(leaky)
        assertEquals("Something went wrong with that purchase. Please try again.", shown)
        // A store id, a URL or a token tells the customer nothing and reads as a broken app.
        assertFalse(shown.contains("http"))
        assertFalse(shown.contains("PGRST"))
        assertFalse(shown.contains("Bearer"))
    }
}
