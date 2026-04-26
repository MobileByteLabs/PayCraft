package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus

enum class RestoreResult { Success, Failure }

data class PayCraftPaywallState(
    val billingState: BillingState = BillingState.Loading,
    val plans: List<BillingPlan> = emptyList(),
    val benefits: List<BillingBenefit> = emptyList(),
    val selectedPlan: BillingPlan? = null,
    val email: String = "",
    val emailError: String? = null,
    val isSubmitting: Boolean = false,
    val supportEmail: String = "",
    val userEmail: String? = null,
    val errorMessage: String? = null,
    val currentPlanRank: Int = 0,
    val isRestoring: Boolean = false,
    val restoreResult: RestoreResult? = null,
) {
    val isLoggedIn: Boolean get() = userEmail != null
    val isPremium: Boolean get() = billingState is BillingState.Premium
    val subscriptionStatus: SubscriptionStatus?
        get() = (billingState as? BillingState.Premium)?.status
    val isLoading: Boolean get() = billingState is BillingState.Loading || isSubmitting
    val isEmailValid: Boolean get() = email.contains("@") && email.contains(".")

    fun isPlanDisabled(plan: BillingPlan): Boolean = isPremium && plan.rank < currentPlanRank
    fun isPlanActive(plan: BillingPlan): Boolean = isPremium && plan.rank == currentPlanRank
    fun canUpgrade(plan: BillingPlan): Boolean = !isPremium || plan.rank > currentPlanRank
}
