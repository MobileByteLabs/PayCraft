package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingPlan

sealed interface PayCraftPaywallAction {
    data class SelectPlan(val plan: BillingPlan) : PayCraftPaywallAction
    data class UpdateEmail(val email: String) : PayCraftPaywallAction
    data object Subscribe : PayCraftPaywallAction
    data object ManageSubscription : PayCraftPaywallAction
    data object LogIn : PayCraftPaywallAction
    data object LogOut : PayCraftPaywallAction
    data object Dismiss : PayCraftPaywallAction
    data object RefreshStatus : PayCraftPaywallAction
    data object ContactSupport : PayCraftPaywallAction
    data object ClearError : PayCraftPaywallAction
}
