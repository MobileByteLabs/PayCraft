package com.mobilebytelabs.paycraft.fee

/** Settlement jurisdiction — drives which billing lanes are legally permitted (D2). */
enum class Jurisdiction { US, EU, SOUTH_KOREA, BRAZIL, GLOBAL }

/** A legal billing channel; store commission differs per lane per jurisdiction. */
enum class BillingLane { READER_APP, US_EXTERNAL_LINK, EU_DMA_CTC, GOOGLE_ALT_BILLING, PURE_WEB, NATIVE_IAP }

/** PSP processing rate as a fraction of gross — a HARD economic floor (D3). */
data class PspRate(val fraction: Double) {
    init { require(fraction > 0.0) { "PSP rate is a hard floor and must be positive" } }
}

/** Resolved quote; [total] is never below [pspFloor]. */
data class FeeQuote(
    val jurisdiction: Jurisdiction,
    val lane: BillingLane,
    val pspFloor: Double,
    val storeTax: Double,
    val total: Double,
)
