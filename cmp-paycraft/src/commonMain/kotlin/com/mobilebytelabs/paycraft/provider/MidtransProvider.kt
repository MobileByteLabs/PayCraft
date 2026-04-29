package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Midtrans payment provider.
 *
 * Uses Midtrans Snap payment links for subscription checkout.
 * Popular in Southeast Asia (Indonesia, Singapore, Malaysia, Thailand).
 *
 * @param paymentLinks plan_id → Midtrans payment link
 * @param isTestMode true = sandbox, false = production
 */
class MidtransProvider(private val paymentLinks: Map<String, String>, val isTestMode: Boolean = false) :
    PaymentProvider {

    override val name = "midtrans"
    override val webhookFunctionName = "midtrans-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String = paymentLinks[plan.id]
        ?: error("No payment link configured for plan '${plan.id}'")

    override fun getManageUrl(email: String): String? = null
}
