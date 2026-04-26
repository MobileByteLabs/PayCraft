package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Stripe payment provider.
 *
 * Supports dual test/live mode:
 * - [isTestMode] = true  → uses [testPaymentLinks] and [testPortalUrl]  (sandbox, 4242 test cards)
 * - [isTestMode] = false → uses [livePaymentLinks] and [livePortalUrl]  (production)
 *
 * Legacy single-map constructor still works — treated as test links regardless of mode.
 */
class StripeProvider(
    private val testPaymentLinks: Map<String, String> = emptyMap(),
    private val livePaymentLinks: Map<String, String> = emptyMap(),
    private val testPortalUrl: String? = null,
    private val livePortalUrl: String? = null,
    private val isTestMode: Boolean = false,
) : PaymentProvider {

    /** Legacy constructor — single map, treated as test links. */
    constructor(
        paymentLinks: Map<String, String>,
        customerPortalUrl: String? = null,
    ) : this(
        testPaymentLinks = paymentLinks,
        livePaymentLinks = emptyMap(),
        testPortalUrl = customerPortalUrl,
        livePortalUrl = null,
        isTestMode = true,
    )

    override val name = "stripe"
    override val webhookFunctionName = "stripe-webhook"

    /** Exposed for debug logging in PayCraft.configure(). */
    internal val modeLabel
        get() = if (isTestMode) "TEST mode (sandbox — use 4242 test cards)" else "LIVE mode (production — real cards)"
    internal val testLinkCount get() = testPaymentLinks.count { it.value.isNotBlank() }
    internal val liveLinkCount get() = livePaymentLinks.count { it.value.isNotBlank() }

    private val activeLinks get() = if (isTestMode) testPaymentLinks else livePaymentLinks
    private val activePortalUrl get() = if (isTestMode) testPortalUrl else livePortalUrl
    private val modeName get() = if (isTestMode) "TEST" else "LIVE"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val baseUrl = activeLinks[plan.id]
            ?: error(
                "No $modeName payment link configured for plan '${plan.id}'. Run /paycraft-adopt → [F] Fix Phase 3.",
            )
        val url = if (email != null) "$baseUrl?prefilled_email=$email" else baseUrl
        PayCraftLogger.onCheckout(planId = plan.id, mode = modeName, url = url)
        return url
    }

    override fun getManageUrl(email: String): String? {
        val url = activePortalUrl?.let { "$it?prefilled_email=$email" }
        PayCraftLogger.onManageSubscription(mode = modeName, url = url)
        return url
    }
}
