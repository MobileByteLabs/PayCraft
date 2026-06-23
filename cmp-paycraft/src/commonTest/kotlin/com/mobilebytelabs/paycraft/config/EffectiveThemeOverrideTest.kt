package com.mobilebytelabs.paycraft.config

import androidx.compose.ui.graphics.Color
import com.mobilebytelabs.paycraft.presentation.parseHexColor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks the dashboard `primary_color` → paywall MaterialTheme wiring.
 *
 * Regression context: the v1 [com.mobilebytelabs.paycraft.ui.PayCraftPaywall] never
 * wrapped in `PayCraftThemeProvider`, and even the v2 path only forwarded `theme_jsonb`.
 * The dashboard Paywall designer writes the brand color into the dedicated
 * `primary_color` column (NOT `theme_jsonb`), so the configured color silently dropped
 * and the paywall inherited the host app's MaterialTheme primary (reels-downloader blue).
 *
 * [effectiveThemeOverride] is the merge point both paywall paths now consume; these tests
 * pin its contract so the brand color can never silently drop again.
 */
class EffectiveThemeOverrideTest {

    @Test
    fun primaryColorColumn_isInjectedAsPrimaryOverride() {
        val dto = PaywallDto(primaryColor = "#3a91ee")
        assertEquals("#3a91ee", dto.effectiveThemeOverride["primary"])
    }

    @Test
    fun primaryColorColumn_mergesWithThemeJsonbOtherKeys() {
        val dto = PaywallDto(
            primaryColor = "#3a91ee",
            themeJsonb = mapOf("secondary" to "#FFB400", "surface" to "#FFFFFF"),
        )
        val merged = dto.effectiveThemeOverride
        assertEquals("#3a91ee", merged["primary"])
        assertEquals("#FFB400", merged["secondary"])
        assertEquals("#FFFFFF", merged["surface"])
    }

    @Test
    fun primaryColorColumn_winsOverLegacyThemeJsonbPrimary() {
        val dto = PaywallDto(
            primaryColor = "#3a91ee",
            themeJsonb = mapOf("primary" to "#000000"),
        )
        assertEquals("#3a91ee", dto.effectiveThemeOverride["primary"])
    }

    @Test
    fun nullPrimaryColor_doesNotInjectPrimaryKey() {
        val dto = PaywallDto(primaryColor = null, themeJsonb = emptyMap())
        assertFalse(dto.effectiveThemeOverride.containsKey("primary"))
        assertTrue(dto.effectiveThemeOverride.isEmpty())
    }

    @Test
    fun blankPrimaryColor_doesNotInjectPrimaryKey() {
        val dto = PaywallDto(primaryColor = "   ", themeJsonb = emptyMap())
        assertFalse(dto.effectiveThemeOverride.containsKey("primary"))
    }

    @Test
    fun parseHexColor_resolvesSixDigitToOpaqueRgb() {
        // The stored brand color must round-trip to the exact RGB the theme applies.
        val parsed = parseHexColor("#3a91ee")
        assertEquals(Color(red = 0x3a, green = 0x91, blue = 0xee, alpha = 0xFF), parsed)
    }
}
