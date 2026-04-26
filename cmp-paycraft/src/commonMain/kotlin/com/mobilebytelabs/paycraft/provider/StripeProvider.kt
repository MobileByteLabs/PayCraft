package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Stripe payment provider.
 *
 * Supports dual test/live mode:
 * - [isTestMode] = true  → uses [testPaymentLinks] and [testPortalUrl]  (sandbox, 4242 test cards)
 * - [isTestMode] = false → uses [livePaymentLinks] and [livePortalUrl]  (production)
 *
 * Legacy single-map constructor still works — treated as the active links regardless of mode.
 */
class StripeProvider(
    private val testPaymentLinks: Map<String, String> = emptyMap(),
    private val livePaymentLinks: Map<String, String> = emptyMap(),
    private val testPortalUrl: String? = null,
    private val livePortalUrl: String? = null,
    private val isTestMode: Boolean = false,
) : PaymentProvider {

    /** Legacy constructor — single map, no mode switching. */
    constructor(
        paymentLinks: Map<String, String>,
        customerPortalUrl: String? = null,
    ) : this(
        testPaymentLinks = paymentLinks,
        livePaymentLinks = paymentLinks,
        testPortalUrl = customerPortalUrl,
        livePortalUrl = customerPortalUrl,
        isTestMode = true,
    )

    override val name = "stripe"
    override val webhookFunctionName = "stripe-webhook"

    private val activeLinks get() = if (isTestMode) testPaymentLinks else livePaymentLinks
    private val activePortalUrl get() = if (isTestMode) testPortalUrl else livePortalUrl

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = activeLinks[plan.id]
            ?: error("No ${if (isTestMode) "test" else "live"} payment link configured for plan '${plan.id}'")
        return if (email != null) "$baseUrl?prefilled_email=$email" else baseUrl
    }

    override fun getManageUrl(email: String): String? = activePortalUrl?.let { "$it?prefilled_email=$email" }
}
