package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Paystack payment provider.
 *
 * Uses Paystack payment pages for subscription checkout.
 * Popular in Africa (Nigeria, Ghana, South Africa, Kenya).
 *
 * @param testPaymentLinks plan_id → Paystack payment page URL (test)
 * @param livePaymentLinks plan_id → Paystack payment page URL (live)
 * @param isTestMode true = test keys, false = live keys
 */
class PaystackProvider(
    private val testPaymentLinks: Map<String, String> = emptyMap(),
    private val livePaymentLinks: Map<String, String> = emptyMap(),
    val isTestMode: Boolean = false,
) : PaymentProvider {

    override val name = "paystack"
    override val webhookFunctionName = "paystack-webhook"

    private val activeLinks get() = if (isTestMode) testPaymentLinks else livePaymentLinks
    private val modeName get() = if (isTestMode) "TEST" else "LIVE"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String = activeLinks[plan.id]
        ?: error("No $modeName payment link configured for plan '${plan.id}'")

    override fun getManageUrl(email: String): String? = null
}
