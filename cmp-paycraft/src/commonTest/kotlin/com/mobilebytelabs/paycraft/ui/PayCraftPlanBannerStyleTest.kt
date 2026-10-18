package com.mobilebytelabs.paycraft.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The banner preset set, asserted as a CONTRACT rather than as pixels.
 *
 * `PayCraftPlanBanner` and `PayCraftPremiumBanner` were two public composables doing one job. Merging
 * them into [PayCraftPlanBannerStyle] makes the preset names public API, so renaming one silently
 * breaks every consumer that named it — which is what these assert.
 */
class PayCraftPlanBannerStyleTest {

    @Test
    fun twoStylesAreOffered() {
        // Two, not five. PayCraftPlanSection has five because a settings row has five
        // genuinely different densities; a banner has two real behaviours. Adding presets to match
        // the other component's count would be inventing variants nothing asked for.
        assertEquals(2, PayCraftPlanBannerStyle.entries.size)
    }

    @Test
    fun everyStyleIsNamedAndDistinct() {
        assertEquals(
            setOf("Adaptive", "Upsell"),
            PayCraftPlanBannerStyle.entries.map { it.name }.toSet(),
            "the preset set is public API — renaming one silently breaks every consumer that named it",
        )
    }

    @Test
    fun adaptiveIsTheDefault() {
        // A host that passes no style gets the preset that shows a SUBSCRIBER their subscription.
        // Defaulting to Upsell would make the common drop-in render nothing for paying users, which
        // reads as a broken screen rather than a deliberate one.
        assertTrue(PayCraftPlanBannerStyle.entries.contains(PayCraftPlanBannerStyle.Adaptive))
        assertEquals(PayCraftPlanBannerStyle.Adaptive, PayCraftPlanBannerStyle.entries.first())
    }
}
