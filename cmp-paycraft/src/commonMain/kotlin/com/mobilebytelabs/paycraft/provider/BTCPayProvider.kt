package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * BTCPay Server payment provider.
 *
 * Self-hosted Bitcoin/Lightning payment processor. No third-party custody.
 * Each plan maps to a BTCPay payment request or point-of-sale item.
 *
 * @param serverUrl BTCPay Server base URL (e.g., "https://btcpay.example.com")
 * @param paymentLinks plan_id → BTCPay invoice/payment-request URL
 */
class BTCPayProvider(private val serverUrl: String, private val paymentLinks: Map<String, String>) : PaymentProvider {

    override val name = "btcpay"
    override val webhookFunctionName = "btcpay-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String = paymentLinks[plan.id]
        ?: error("No BTCPay payment link configured for plan '${plan.id}'")

    override fun getManageUrl(email: String): String? = null
}
