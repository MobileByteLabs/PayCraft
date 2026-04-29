package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * LemonSqueezy payment provider.
 *
 * Uses LemonSqueezy checkout overlay links.
 * Test mode uses LemonSqueezy's built-in test mode toggle.
 *
 * @param paymentLinks plan_id → LemonSqueezy checkout URL
 * @param isTestMode true = test mode, false = live
 */
class LemonSqueezyProvider(private val paymentLinks: Map<String, String>, val isTestMode: Boolean = false) :
    PaymentProvider {

    override val name = "lemonsqueezy"
    override val webhookFunctionName = "lemonsqueezy-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = paymentLinks[plan.id]
            ?: error("No payment link configured for plan '${plan.id}'")
        return if (email != null) "$baseUrl?checkout[email]=$email" else baseUrl
    }

    override fun getManageUrl(email: String): String? = null
}
