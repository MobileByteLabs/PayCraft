package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.ui.components.parseHeroIconPath
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Contract for the dashboard branding-icon override (PaywallDto.heroIconSvg → ImageVector).
 *
 * Proves a tenant can replace the SDK's default hero icon with their own app's mark by
 * supplying inline 24×24 SVG path data, while malformed/absent input safely returns null so
 * callers fall back to the default icon (never a blank hero).
 */
class HeroIconOverrideTest {

    @Test
    fun validPathData_parsesToImageVector() {
        // A simple star path (24×24 viewport) — the kind the dashboard would store.
        val star = "M12 2L15 9L22 9L16 14L18 22L12 17L6 22L8 14L2 9L9 9Z"
        assertNotNull(parseHeroIconPath(star))
    }

    @Test
    fun simpleTrianglePath_parsesToImageVector() {
        assertNotNull(parseHeroIconPath("M8 5v14l11-7z"))
    }

    @Test
    fun nullInput_returnsNull() {
        assertNull(parseHeroIconPath(null))
    }

    @Test
    fun blankInput_returnsNull() {
        assertNull(parseHeroIconPath("   "))
    }

    @Test
    fun garbageInput_returnsNullNotCrash() {
        assertNull(parseHeroIconPath("not a path at all !!!"))
    }
}
