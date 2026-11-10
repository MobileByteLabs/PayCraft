package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SuiteConfig JSON contract for trial fields.
 *
 * The dashboard Edge Function (`functions/v1/config`) emits `trial_enabled` +
 * `trial_duration_days` per product. The SDK MUST tolerate older payloads where
 * these fields are absent (defaults: enabled=true, days=7).
 */
class TrialConfigTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun product_with_explicit_trial_fields_parses() {
        val payload = """
            {
              "id": "p1",
              "sku": "monthly",
              "type": "subscription",
              "display_name": "Monthly",
              "interval": "month",
              "base_price_cents": 999,
              "base_currency": "USD",
              "trial_enabled": false,
              "trial_duration_days": 14
            }
        """.trimIndent()

        val dto = json.decodeFromString<ProductDto>(payload)
        assertEquals(false, dto.trialEnabled)
        assertEquals(14, dto.trialDurationDays)
    }

    @Test
    fun product_without_trial_fields_defaults_to_enabled_seven_days() {
        val payload = """
            {
              "id": "p1",
              "sku": "monthly",
              "type": "subscription",
              "display_name": "Monthly",
              "interval": "month",
              "base_price_cents": 999,
              "base_currency": "USD"
            }
        """.trimIndent()

        val dto = json.decodeFromString<ProductDto>(payload)
        assertEquals(true, dto.trialEnabled)
        assertEquals(7, dto.trialDurationDays)
    }

    @Test
    fun trial_fields_round_trip_through_serialization() {
        val original = ProductDto(
            id = "p1",
            sku = "annual",
            type = "subscription",
            displayName = "Annual",
            interval = "year",
            basePriceCents = 7999,
            baseCurrency = "USD",
            trialEnabled = false,
            trialDurationDays = 30,
        )
        val encoded = json.encodeToString(ProductDto.serializer(), original)
        val decoded = json.decodeFromString<ProductDto>(encoded)
        assertEquals(original.trialEnabled, decoded.trialEnabled)
        assertEquals(original.trialDurationDays, decoded.trialDurationDays)
        // Wire format uses snake_case
        assertTrue(encoded.contains("\"trial_enabled\""))
        assertTrue(encoded.contains("\"trial_duration_days\""))
    }
}
