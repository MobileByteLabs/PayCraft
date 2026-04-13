package com.mobilebytelabs.paycraft.model

data class BillingPlan(
    val id: String,
    val name: String,
    val price: String,
    val interval: String,
    val rank: Int,
    val isPopular: Boolean = false,
)
