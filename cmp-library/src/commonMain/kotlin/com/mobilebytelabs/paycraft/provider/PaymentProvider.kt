package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * Payment provider abstraction.
 * The app never talks to the provider directly — only Supabase.
 * The provider is only used for:
 * 1. Getting checkout URLs (where to send user to pay)
 * 2. Getting manage URLs (where user can cancel/update)
 */
interface PaymentProvider {
    val name: String

    fun getCheckoutUrl(plan: BillingPlan, email: String? = null): String

    fun getManageUrl(email: String): String?

    val webhookFunctionName: String
}
