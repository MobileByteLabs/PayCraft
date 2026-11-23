package com.mobilebytelabs.paycraft.config

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The tenant's running paywall A/B experiment, as `/config` serves it (migration 206). A variant is an OFFERING —
 * which plans, at which prices — so applying one is choosing which offering this device sees.
 */
@Serializable
data class ExperimentDto(
    val key: String = "",
    val variants: List<ExperimentVariantDto> = emptyList(),
)

@Serializable
data class ExperimentVariantDto(
    val key: String = "",
    val weight: Int = 0,
    @SerialName("offering_id") val offeringId: String = "",
)

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
    val exp = experiment ?: return this to null
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
