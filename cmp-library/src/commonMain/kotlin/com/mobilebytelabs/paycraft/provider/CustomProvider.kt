package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

class CustomProvider(
    override val name: String,
    override val webhookFunctionName: String,
    private val checkoutUrlBuilder: (BillingPlan, String?) -> String,
    private val manageUrlBuilder: ((String) -> String)? = null,
) : PaymentProvider {
    override fun getCheckoutUrl(plan: BillingPlan, email: String?) = checkoutUrlBuilder(plan, email)

    override fun getManageUrl(email: String) = manageUrlBuilder?.invoke(email)
}
