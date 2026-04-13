package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

class RazorpayProvider(private val paymentLinks: Map<String, String>, private val dashboardUrl: String? = null) :
    PaymentProvider {
    override val name = "razorpay"
    override val webhookFunctionName = "razorpay-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String = paymentLinks[plan.id]
        ?: error("No payment link configured for plan '${plan.id}'")

    override fun getManageUrl(email: String): String? = dashboardUrl
}
