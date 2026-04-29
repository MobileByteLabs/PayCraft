package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Flutterwave payment provider.
 *
 * Uses Flutterwave payment links for subscription checkout.
 * Popular in Africa (Nigeria, Ghana, Kenya, South Africa).
 *
 * @param paymentLinks plan_id → Flutterwave payment link
 * @param isTestMode true = test, false = live
 */
class FlutterwaveProvider(private val paymentLinks: Map<String, String>, val isTestMode: Boolean = false) :
    PaymentProvider {

    override val name = "flutterwave"
    override val webhookFunctionName = "flutterwave-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = paymentLinks[plan.id]
            ?: error("No payment link configured for plan '${plan.id}'")
        return if (email != null) "$baseUrl?customer[email]=$email" else baseUrl
    }

    override fun getManageUrl(email: String): String? = null
}
