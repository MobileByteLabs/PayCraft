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

    /**
     * REVISED 2026-09-17 after a device run disproved the original expectation.
     *
     * This test used to assert that Play's "Product not found" maps to "…Try another plan…". That
     * is wrong, and the device showed why: on cappy the plan WAS bound correctly
     * (`storeBinding(provider=google_play, productId=com.mobilebytesensei.cappy.sub.year)`) and the
     * product WAS present in the Play Console — yet Play still refused, because the installed APK
     * was `CN=Android Debug` at versionCode 1. Play serves in-app products only to a build whose
     * package AND signing certificate match one distributed through Play.
     *
     * So this class of failure is not per-plan at all: every plan fails identically, and telling the
     * customer to "try another plan" walks them in a circle. The copy has to point at the build.
     */
    @Test
    fun a_store_that_cannot_match_this_build_does_not_tell_the_user_to_try_another_plan() {
        val shown = humanBillingError("Play purchase failed: Product not found on Play: com.mobilebytesensei.cappy.sub.year")
        assertEquals(
            "Purchases aren't available in this build. Install the app from the store to subscribe.",
            shown,
        )
        // The circular advice must not come back: no plan swap can fix a build mismatch.
        assertFalse(shown.contains("another plan"))
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

    /**
     * The three refusals are distinct causes and must not collapse into one sentence.
     *
     * `PayCraftBillingManager` refuses for a missing native client (the host app never loaded a
     * billing module — a developer error) and for a blank product id (the plan carries no store
     * binding — a dashboard error), while Play's own "not found" is a third (build/catalogue). All
     * three used to render the same line, which is why diagnosing the cappy failure needed a
     * logcat capture instead of reading the screen.
     */
    @Test
    fun the_three_refusal_causes_are_distinguishable_on_screen() {
        val build = humanBillingError("Play purchase failed: Product not found on Play: x.y.z")
        val plan = humanBillingError("product id missing for c0fd8d93 — refusing web fallback (store anti-steering)")
        val app = humanBillingError("no NativeBillingClient wired for c0fd8d93 — load the platform billing module")
        assertEquals(3, setOf(build, plan, app).size)
        assertEquals("Purchases aren't set up in this app yet.", app)
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
