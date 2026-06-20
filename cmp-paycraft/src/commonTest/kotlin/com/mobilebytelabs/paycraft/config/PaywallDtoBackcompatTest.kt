package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Round-trip tests for PaywallDto v2 (migration 071 / cmp-paycraft 2.1.0+).
 *
 * Two concerns covered:
 *
 *   1. **Forward-compat for pre-2.1.0 consumers** — when a v2 `/config`
 *      response (which carries the 14 new content fields like hero_title /
 *      value_props / popular_plan_sku / etc.) is deserialized by a 2.0.10
 *      consumer that doesn't know about those fields, kotlinx.serialization
 *      with `ignoreUnknownKeys = true` (the SDK's default Json configuration)
 *      MUST silently drop them — no exception, no logging. PR #100's
 *      ConfigClient sets `ignoreUnknownKeys = true` so this is the contract.
 *
 *   2. **Backward-compat for v2 deserializer reading v1 payloads** — when a
 *      v1 `/config` response (missing the 14 v2 fields) is deserialized by
 *      a 2.1.0 PaywallDto, the missing fields MUST fall through to the
 *      defaults declared on the data class (e.g. `heroTitle = "Upgrade to
 *      Premium"`). No exception, no nulls.
 */
class PaywallDtoBackcompatTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun v2_response_parses_with_v2_deserializer_full_round_trip() {
        val v2Wire = """
            {
              "template": "branded-stack",
              "branding": "attribution",
              "hero_title": "Custom Title",
              "hero_subtitle": "Custom Subtitle",
              "value_props": [
                {"icon": "ad-free", "title": "Ad-free", "description": "No interruptions"},
                {"icon": "hd", "title": "HD Downloads"}
              ],
              "cta_continue": "Subscribe",
              "cta_get_premium": "Upgrade",
              "restore_label": "Restore",
              "popular_plan_sku": "pro-quarterly",
              "success_title": "Yay!",
              "success_message": "You are premium.",
              "success_cta_label": "Continue",
              "hero_icon_svg": "<svg viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/></svg>"
            }
        """.trimIndent()
        val dto = json.decodeFromString<PaywallDto>(v2Wire)
        assertEquals("branded-stack", dto.template)
        assertEquals("Custom Title", dto.heroTitle)
        assertEquals("Custom Subtitle", dto.heroSubtitle)
        assertEquals(2, dto.valueProps.size)
        assertEquals("ad-free", dto.valueProps[0].icon)
        assertEquals("Ad-free", dto.valueProps[0].title)
        assertEquals("No interruptions", dto.valueProps[0].description)
        assertEquals("hd", dto.valueProps[1].icon)
        assertNull(dto.valueProps[1].description)
        assertEquals("Subscribe", dto.ctaContinue)
        assertEquals("Upgrade", dto.ctaGetPremium)
        assertEquals("Restore", dto.restoreLabel)
        assertEquals("pro-quarterly", dto.popularPlanSku)
        assertEquals("Yay!", dto.successTitle)
        assertTrue(dto.heroIconSvg!!.startsWith("<svg"))
    }

    @Test
    fun v1_response_parses_with_v2_deserializer_falls_through_to_defaults() {
        // Pre-migration-071 /config response — only v1 fields present.
        // Every v2 field must fall back to its declared default on PaywallDto.
        val v1Wire = """
            {
              "template": "minimal",
              "branding": "attribution",
              "primary_color": "#7C3AED",
              "support_email": "support@example.com"
            }
        """.trimIndent()
        val dto = json.decodeFromString<PaywallDto>(v1Wire)
        // v1 fields populated
        assertEquals("minimal", dto.template)
        assertEquals("#7C3AED", dto.primaryColor)
        assertEquals("support@example.com", dto.supportEmail)
        // v2 defaults match migration 071 column DEFAULT clauses
        assertEquals("Upgrade to Premium", dto.heroTitle)
        assertEquals(
            "Enjoy ad-free experience, HD downloads, and exclusive features",
            dto.heroSubtitle,
        )
        assertEquals(emptyList(), dto.valueProps)
        assertEquals("Continue", dto.ctaContinue)
        assertEquals("Get Premium", dto.ctaGetPremium)
        assertEquals("Restore Your Premium", dto.restoreLabel)
        assertNull(dto.popularPlanSku)
        assertEquals("Welcome to Premium!", dto.successTitle)
        assertEquals(
            "You now have access to all premium features.",
            dto.successMessage,
        )
        assertEquals("Continue to app", dto.successCtaLabel)
        assertNull(dto.heroIconSvg)
        assertNull(dto.heroIconUrl)
    }

    @Test
    fun extra_unknown_fields_dont_crash_with_ignoreUnknownKeys() {
        // Forward-compat — a future cmp-paycraft 2.2.0 might add fields the
        // current 2.1.0 deserializer doesn't know about. With
        // ignoreUnknownKeys=true (the SDK's default), they're silently dropped.
        val future = """
            {
              "template": "branded-stack",
              "hero_title": "X",
              "hero_animation_url": "https://cdn.example.com/anim.lottie",
              "ai_persona_id": "warm-greeter-v3"
            }
        """.trimIndent()
        val dto = json.decodeFromString<PaywallDto>(future)
        assertEquals("X", dto.heroTitle)
        // Unknown fields silently dropped — no exception, no crash.
    }

    @Test
    fun zero_value_props_yields_empty_list_not_null() {
        val wire = """{"template":"branded-stack"}"""
        val dto = json.decodeFromString<PaywallDto>(wire)
        assertEquals(emptyList(), dto.valueProps)
    }

    @Test
    fun value_prop_with_only_icon_and_title_parses_with_null_description() {
        val wire = """
            {
              "template": "branded-stack",
              "value_props": [{"icon": "hd", "title": "HD"}]
            }
        """.trimIndent()
        val dto = json.decodeFromString<PaywallDto>(wire)
        assertEquals(1, dto.valueProps.size)
        assertEquals("hd", dto.valueProps[0].icon)
        assertEquals("HD", dto.valueProps[0].title)
        assertNull(dto.valueProps[0].description)
    }
}
