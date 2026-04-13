package com.mobilebytelabs.paycraft.ui

sealed interface PayCraftPaywallEvent {
    data object Dismissed : PayCraftPaywallEvent
    data class CheckoutLaunched(val url: String) : PayCraftPaywallEvent
    data class ManageLaunched(val url: String) : PayCraftPaywallEvent
    data class SupportEmailOpened(val email: String) : PayCraftPaywallEvent
    data class ErrorOccurred(val message: String) : PayCraftPaywallEvent
}
