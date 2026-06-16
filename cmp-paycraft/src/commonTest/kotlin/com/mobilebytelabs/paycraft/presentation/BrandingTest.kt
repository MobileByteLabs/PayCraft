package com.mobilebytelabs.paycraft.presentation

import kotlin.test.Test
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull

class BrandingTest {

    @Test
    fun parse_attribution_returns_Attribution() {
        val result = Branding.parse("attribution")
        assertIs<Branding.Attribution>(result)
    }

    @Test
    fun parse_attribution_caseInsensitive() {
        assertIs<Branding.Attribution>(Branding.parse("ATTRIBUTION"))
        assertIs<Branding.Attribution>(Branding.parse("Attribution"))
    }

    @Test
    fun parse_none_returns_None() {
        val result = Branding.parse("none")
        assertIs<Branding.None>(result)
    }

    @Test
    fun parse_none_caseInsensitive() {
        assertIs<Branding.None>(Branding.parse("NONE"))
    }

    @Test
    fun parse_custom_falls_back_to_Attribution() {
        // "custom" from server needs a non-null custom_footer to upgrade to Custom;
        // parse() alone returns Attribution as a safe default.
        val result = Branding.parse("custom")
        assertIs<Branding.Attribution>(result)
    }

    @Test
    fun parse_unknown_value_falls_back_to_Attribution() {
        assertIs<Branding.Attribution>(Branding.parse(""))
        assertIs<Branding.Attribution>(Branding.parse("unknown_tier"))
    }

    @Test
    fun Attribution_is_not_None() {
        val a: Branding = Branding.Attribution
        val n: Branding = Branding.None
        assertNotEquals(a, n)
    }

    @Test
    fun Custom_holds_composable_reference() {
        val custom = Branding.Custom(footer = {})
        assertNotNull(custom.footer)
    }
}
