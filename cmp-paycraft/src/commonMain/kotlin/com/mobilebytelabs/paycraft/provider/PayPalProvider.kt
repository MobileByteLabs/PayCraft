package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * PayPal payment provider.
 *
 * Uses PayPal subscription links (hosted buttons).
 * Sandbox vs live determined by [isTestMode].
 *
 * @param testPaymentLinks plan_id → PayPal subscription link (sandbox)
 * @param livePaymentLinks plan_id → PayPal subscription link (live)
 * @param isTestMode true = sandbox, false = live
 */
class PayPalProvider(
    private val testPaymentLinks: Map<String, String> = emptyMap(),
    private val livePaymentLinks: Map<String, String> = emptyMap(),
    val isTestMode: Boolean = false,
) : PaymentProvider {

    override val name = "paypal"
    override val webhookFunctionName = "paypal-webhook"

    private val activeLinks get() = if (isTestMode) testPaymentLinks else livePaymentLinks
    private val modeName get() = if (isTestMode) "TEST" else "LIVE"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String = activeLinks[plan.id]
        ?: error("No $modeName payment link configured for plan '${plan.id}'")

    override fun getManageUrl(email: String): String? = null
}
