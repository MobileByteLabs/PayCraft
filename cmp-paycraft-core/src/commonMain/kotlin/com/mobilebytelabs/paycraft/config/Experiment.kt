package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The tenant's running paywall A/B experiment, as `/config` serves it (migration 206). A variant is an OFFERING —
 * which plans, at which prices — so applying one is choosing which offering this device sees.
 */
data class ExperimentDto(val key: String = "", val variants: List<ExperimentVariantDto> = emptyList())

/**
 * [defaultSku]: the plan this variant's paywall opens on (migration 221); null = the paywall's own default.
 * [exitOffer] (227): `false` = no exit offer for this arm, an object = this arm's discount, absent = the tenant's.
 * [paywallTemplate] (227): this arm's design; null = the paywall's own.
 */
data class ExperimentVariantDto(
    val key: String = "",
    val weight: Int = 0,
    val offeringId: String = "",
    val defaultSku: String? = null,
    val exitOffer: JsonElement? = null,
    val paywallTemplate: String? = null,
)

/** The wire form `/config` serves: `{ key, variants: [{ key, weight, offering_id, default_sku? }] }`. */
fun ExperimentDto.toJson(): JsonObject = buildJsonObject {
    put("key", key)
    put(
        "variants",
        buildJsonArray {
            variants.forEach { v ->
                add(
                    buildJsonObject {
                        put("key", v.key)
                        put("weight", v.weight)
                        put("offering_id", v.offeringId)
                        v.defaultSku?.let { put("default_sku", it) }
                        v.paywallTemplate?.let { put("paywall_template", it) }
                        v.exitOffer?.let { put("exit_offer", it) }
                    },
                )
            }
        },
    )
}

/** The served experiment, or null when absent or malformed (a malformed one must never break the paywall). */
fun SuiteConfig.experimentOrNull(): ExperimentDto? {
    val o = experiment ?: return null
    fun JsonObject.str(k: String) = (get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
    val variants = (o["variants"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map {
        ExperimentVariantDto(
            it.str("key"),
            (it["weight"] as? JsonPrimitive)?.intOrNull ?: 0,
            it.str("offering_id"),
            it.str("default_sku").ifBlank { null },
            it["exit_offer"]?.takeIf { e -> e is JsonObject || (e as? JsonPrimitive)?.booleanOrNull == false },
            it.str("paywall_template").ifBlank { null },
        )
    }
    return ExperimentDto(o.str("key"), variants).takeIf { it.key.isNotBlank() }
}

/**
 * Which variant of which experiment this device is in — tagged onto every paywall event. [defaultSku]: the plan the
 * paywall pre-selects for this variant, already checked to be one the variant sells; null = the paywall's default.
 */
data class ExperimentAssignment(
    val experiment: String,
    val variant: String,
    val defaultSku: String? = null,
    /** The variant's exit-offer choice (227): `false` off, an object its discount, null the tenant's. */
    val exitOffer: JsonElement? = null,
)

/** The exit survey as the device's variant sees it: the exit offer turned off or replaced; else unchanged. */
fun ExitSurveyConfig?.forVariant(a: ExperimentAssignment?): ExitSurveyConfig? {
    val cfg = this ?: return null
    val choice = a?.exitOffer ?: return cfg
    val offer = (choice as? JsonObject)?.let {
        val pct = (it["percent_off"] as? JsonPrimitive)?.intOrNull ?: return@let null
        ExitSurveyConfig.Offer(
            percentOff = pct,
            duration = (it["duration"] as? JsonPrimitive)?.contentOrNull ?: "once",
            durationInMonths = (it["duration_in_months"] as? JsonPrimitive)?.intOrNull,
        )
    }
    return ExitSurveyConfig(cfg.enabled || offer != null, cfg.title, cfg.reasons, cfg.capDays, offer)
}

/**
 * The device's variant: FNV-1a of `key:unitId` into the weights. Deterministic, so a device keeps its variant
 * across launches and config refreshes with no server state, and the dashboard's per-device counts line up with
 * what each device actually saw. Null when the experiment has no usable variant.
 */
internal fun ExperimentDto.assign(unitId: String): ExperimentVariantDto? {
    val arms = variants.filter { it.weight > 0 && it.key.isNotBlank() }
    val total = arms.sumOf { it.weight }
    if (key.isBlank() || total <= 0) return null
    var h = 0x811c9dc5.toInt()
    for (c in "$key:$unitId") h = (h xor c.code) * 0x01000193
    var bucket = (h.toLong() and 0xffffffffL) % total
    for (arm in arms) {
        if (bucket < arm.weight) return arm
        bucket -= arm.weight
    }
    return arms.last()
}

/**
 * This config as the device's variant sees it: the variant's offering becomes the current one, and products that
 * only OTHER variants sell are dropped, so both the plan list and role lookups show exactly the variant's plans.
 * Products no variant mentions are untouched. Without an experiment, or when the variant's offering is missing from
 * the payload or sells nothing, the config is returned unchanged — a broken experiment must fall back to the normal paywall.
 */
internal fun SuiteConfig.withExperimentAssigned(unitId: String): Pair<SuiteConfig, ExperimentAssignment?> {
    val exp = experimentOrNull() ?: return this to null
    val arm = exp.assign(unitId) ?: return this to null
    val chosen = offerings.firstOrNull { it.id == arm.offeringId } ?: return this to null
    val skusOf = { offeringId: String ->
        offerings.firstOrNull { it.id == offeringId }?.packages?.flatMap { it.productSkus }.orEmpty().toSet()
    }
    // An offering that sells nothing would leave this device an empty paywall (migration 209 refuses to start one).
    val kept = skusOf(chosen.id).ifEmpty { return this to null }
    val others = exp.variants.filter { it.offeringId != chosen.id }.flatMap { skusOf(it.offeringId) }.toSet() - kept
    val applied = copy(
        offerings = offerings.map { it.copy(isCurrent = it.id == chosen.id) },
        products = products.filterNot { it.sku in others },
        // A design arm (227) renders its template's seed: the published tree would otherwise win over it.
        paywall = arm.paywallTemplate?.let { paywall.copy(template = it, workflow = null) } ?: paywall,
    )
    // An unknown default sku is dropped here, so the paywall falls back to its own default.
    return applied to ExperimentAssignment(exp.key, arm.key, arm.defaultSku?.takeIf { it in kept }, arm.exitOffer)
}
