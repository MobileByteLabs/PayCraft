package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

class StripeProvider(private val paymentLinks: Map<String, String>, private val customerPortalUrl: String? = null) :
    PaymentProvider {
    override val name = "stripe"
    override val webhookFunctionName = "stripe-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = paymentLinks[plan.id]
            ?: error("No payment link configured for plan '${plan.id}'")
        return if (email != null) "$baseUrl?prefilled_email=$email" else baseUrl
    }

    override fun getManageUrl(email: String): String? = customerPortalUrl?.let { "$it?prefilled_email=$email" }
}
