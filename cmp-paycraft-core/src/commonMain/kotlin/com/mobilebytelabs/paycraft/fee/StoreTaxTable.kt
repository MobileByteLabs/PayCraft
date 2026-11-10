package com.mobilebytelabs.paycraft.fee

/**
 * Jurisdiction-aware store commission — a CONFIGURABLE variable (D2), NEVER a hardcoded
 * store cut (e.g. the 30%/15%/0% Apple, reader-app, and zero-tax figures). Rates are injected
 * (remote config / backend) so US link-out volatility, EU CTC, and Google alt-billing floors
 * can shift per region without a code change.
 */
class StoreTaxTable(private val rates: Map<Pair<Jurisdiction, BillingLane>, Double>) {

    /** Legal store commission for this lane here, or null if the lane is not permitted. */
    fun storeTax(jurisdiction: Jurisdiction, lane: BillingLane): Double? = rates[jurisdiction to lane]

    /** Lanes legally permitted in this jurisdiction, per injected config. */
    fun legalLanes(jurisdiction: Jurisdiction): List<BillingLane> =
        rates.keys.filter { it.first == jurisdiction }.map { it.second }

    companion object {
        /** Build from an injected config map — no store-commission constant lives in source. */
        fun from(config: Map<Pair<Jurisdiction, BillingLane>, Double>) = StoreTaxTable(config)
    }
}
