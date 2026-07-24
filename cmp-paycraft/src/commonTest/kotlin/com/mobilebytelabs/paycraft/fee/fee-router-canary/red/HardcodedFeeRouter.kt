package com.mobilebytelabs.paycraft.fee.canary.red

// RED fixture — MUST fail the fee-router gate. Demonstrates BOTH forbidden anti-patterns:
//   (1) hardcoded store-commission literals (0.30 / 0.15) — violates D2
//   (2) a "router" whose total can dip BELOW the PSP floor — violates D3
class HardcodedFeeRouter {
    private val storeCommission = 0.30 // hardcoded Apple/Google cut — FORBIDDEN (D2)
    private val readerCommission = 0.15 // hardcoded reader-app cut — FORBIDDEN (D2)

    /** Subtracts commission from the PSP floor — can return BELOW the floor (D3 violation). */
    fun total(pspFloor: Double): Double = pspFloor - storeCommission - readerCommission
}
