package com.mobilebytelabs.paycraft.model

data class BillingPlan(
    val id: String,
    val name: String,
    val price: String,
    val interval: String,
    val rank: Int,
    val isPopular: Boolean = false,
    val trialDays: Int? = null,
) {
    init {
        require(trialDays == null || trialDays >= 1) {
            "trialDays must be null (no trial offered) or >= 1; got $trialDays. Use null to disable."
        }
    }
}
