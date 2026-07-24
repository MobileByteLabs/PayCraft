package com.mobilebytelabs.paycraft.fee

/** Honest fee positioning (D3): $0 PayCraft fee + $0 store tax where legal; consumer pays only PSP. */
object FeeDisclosure {
    private fun pct(f: Double): String = "${(f * 100).toString().take(4)}%"

    /** Human-readable, non-deceptive summary — never claims a below-PSP or zero total. */
    fun describe(quote: FeeQuote): String {
        val storeLine = if (quote.storeTax <= 0.0) {
            "\$0 store tax (legal ${quote.lane} lane in ${quote.jurisdiction})"
        } else {
            "store tax ${pct(quote.storeTax)}"
        }
        return "PayCraft fee \$0 · $storeLine · you pay only PSP ${pct(quote.pspFloor)} " +
            "(total ${pct(quote.total)}, never below the ${pct(quote.pspFloor)} PSP floor)"
    }
}
