package com.mobilebytelabs.paycraft.fee

import kotlin.math.max

/**
 * Selects the cheapest LEGAL billing lane per jurisdiction and computes an honest fee:
 * total = pspFloor + store_tax(jurisdiction, lane), clamped so it can NEVER dip below the
 * PSP floor (D3). Store commission is read from the injected [StoreTaxTable] — never a
 * hardcoded store cut such as the 30%/15% Apple/reader-app figures (D2).
 */
class FeeRouter(private val taxTable: StoreTaxTable, private val pspRate: PspRate) {

    fun route(jurisdiction: Jurisdiction): FeeQuote {
        val legal = taxTable.legalLanes(jurisdiction)
        require(legal.isNotEmpty()) { "no legal billing lane for $jurisdiction" }
        val cheapest = legal.minByOrNull { taxTable.storeTax(jurisdiction, it) ?: Double.MAX_VALUE }!!
        return quote(jurisdiction, cheapest)
    }

    fun quote(jurisdiction: Jurisdiction, lane: BillingLane): FeeQuote {
        val tax = taxTable.storeTax(jurisdiction, lane) ?: error("$lane not legal in $jurisdiction")
        val total = max(pspRate.fraction, pspRate.fraction + tax) // never below the PSP floor
        return FeeQuote(jurisdiction, lane, pspRate.fraction, tax, total)
    }
}
