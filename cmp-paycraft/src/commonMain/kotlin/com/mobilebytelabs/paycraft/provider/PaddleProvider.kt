package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Paddle payment provider.
 *
 * Uses Paddle Checkout overlay — payment links open Paddle's hosted checkout.
 * Supports dual test/live via Paddle Sandbox vs Production environment.
 *
 * @param testPaymentLinks plan_id → Paddle checkout link (sandbox)
 * @param livePaymentLinks plan_id → Paddle checkout link (production)
 * @param isTestMode true = sandbox, false = production
 */
class PaddleProvider(
    private val testPaymentLinks: Map<String, String> = emptyMap(),
    private val livePaymentLinks: Map<String, String> = emptyMap(),
    val isTestMode: Boolean = false,
) : PaymentProvider {

    override val name = "paddle"
    override val webhookFunctionName = "paddle-webhook"

    private val activeLinks get() = if (isTestMode) testPaymentLinks else livePaymentLinks
    private val modeName get() = if (isTestMode) "TEST" else "LIVE"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = activeLinks[plan.id]
            ?: error("No $modeName payment link configured for plan '${plan.id}'")
        return if (email != null) "$baseUrl?customer_email=$email" else baseUrl
    }

    override fun getManageUrl(email: String): String? = null
}
