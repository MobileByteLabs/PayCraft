package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The tenant's running paywall A/B experiment, as `/config` serves it (migration 206). A variant is an OFFERING —
 * which plans, at which prices — so applying one is choosing which offering this device sees.
 */
data class ExperimentDto(
    val key: String = "",
    val variants: List<ExperimentVariantDto> = emptyList(),
)

data class ExperimentVariantDto(
    val key: String = "",
    val weight: Int = 0,
    val offeringId: String = "",
)

/** The wire form `/config` serves: `{ key, variants: [{ key, weight, offering_id }] }`. */
fun ExperimentDto.toJson(): JsonObject = buildJsonObject {
    put("key", key)
    put(
        "variants",
        buildJsonArray {
            variants.forEach { v ->
                add(buildJsonObject { put("key", v.key); put("weight", v.weight); put("offering_id", v.offeringId) })
            }
        },
    )
}

/** The served experiment, or null when absent or malformed (a malformed one must never break the paywall). */
fun SuiteConfig.experimentOrNull(): ExperimentDto? {
    val o = experiment ?: return null
    fun JsonObject.str(k: String) = (get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
    val variants = (o["variants"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map {
        ExperimentVariantDto(it.str("key"), (it["weight"] as? JsonPrimitive)?.intOrNull ?: 0, it.str("offering_id"))
    }
    return ExperimentDto(o.str("key"), variants).takeIf { it.key.isNotBlank() }
}

/** Which variant of which experiment this device is in — tagged onto every paywall event. */
data class ExperimentAssignment(val experiment: String, val variant: String)

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
 * the payload, the config is returned unchanged — a broken experiment must fall back to the normal paywall.
 */
internal fun SuiteConfig.withExperimentAssigned(unitId: String): Pair<SuiteConfig, ExperimentAssignment?> {
    val exp = experimentOrNull() ?: return this to null
    val arm = exp.assign(unitId) ?: return this to null
    val chosen = offerings.firstOrNull { it.id == arm.offeringId } ?: return this to null
    val skusOf = { offeringId: String ->
        offerings.firstOrNull { it.id == offeringId }?.packages?.flatMap { it.productSkus }.orEmpty().toSet()
    }
    val kept = skusOf(chosen.id)
    val others = exp.variants.filter { it.offeringId != chosen.id }.flatMap { skusOf(it.offeringId) }.toSet() - kept
    val applied = copy(
        offerings = offerings.map { it.copy(isCurrent = it.id == chosen.id) },
        products = products.filterNot { it.sku in others },
    )
    return applied to ExperimentAssignment(exp.key, arm.key)
}
