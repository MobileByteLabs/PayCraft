package com.mobilebytelabs.paycraft.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import co.touchlab.kermit.Logger
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val TAG = "PayCraftPaywallViewModel"

class PayCraftPaywallViewModel(private val billingManager: BillingManager) : ViewModel() {

    private val _state = MutableStateFlow(PayCraftPaywallState())
    val state: StateFlow<PayCraftPaywallState> = _state.asStateFlow()

    private val _events = Channel<PayCraftPaywallEvent>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    init {
        loadConfig()
        observeBillingState()
    }

    private fun loadConfig() {
        val config = PayCraft.config ?: return
        _state.update { current ->
            current.copy(
                plans = config.plans,
                benefits = config.benefits,
                supportEmail = config.supportEmail,
                selectedPlan = config.plans.firstOrNull { it.isPopular } ?: config.plans.firstOrNull(),
            )
        }
    }

    private fun observeBillingState() {
        viewModelScope.launch {
            billingManager.billingState.collect { billingState ->
                _state.update { current ->
                    current.copy(
                        billingState = billingState,
                        isSubmitting = false,
                        errorMessage = when (billingState) {
                            is BillingState.Error -> billingState.message
                            else -> null
                        },
                    )
                }
            }
        }

        viewModelScope.launch {
            billingManager.userEmail.collect { email ->
                _state.update { current -> current.copy(userEmail = email) }
            }
        }
    }

    fun dispatch(action: PayCraftPaywallAction) {
        Logger.d(TAG) { "Action dispatched: $action" }
        when (action) {
            is PayCraftPaywallAction.SelectPlan -> onSelectPlan(action)
            is PayCraftPaywallAction.UpdateEmail -> onUpdateEmail(action)
            is PayCraftPaywallAction.Subscribe -> onSubscribe()
            is PayCraftPaywallAction.ManageSubscription -> onManageSubscription()
            is PayCraftPaywallAction.LogIn -> onLogIn()
            is PayCraftPaywallAction.LogOut -> onLogOut()
            is PayCraftPaywallAction.Dismiss -> onDismiss()
            is PayCraftPaywallAction.RefreshStatus -> onRefreshStatus()
            is PayCraftPaywallAction.ContactSupport -> onContactSupport()
            is PayCraftPaywallAction.ClearError -> onClearError()
        }
    }

    private fun onSelectPlan(action: PayCraftPaywallAction.SelectPlan) {
        _state.update { it.copy(selectedPlan = action.plan) }
    }

    private fun onUpdateEmail(action: PayCraftPaywallAction.UpdateEmail) {
        _state.update {
            it.copy(
                email = action.email,
                emailError = null,
            )
        }
    }

    private fun onSubscribe() {
        val currentState = _state.value
        val plan = currentState.selectedPlan ?: run {
            _state.update { it.copy(errorMessage = "Please select a plan") }
            return
        }

        val email = currentState.email.trim()
        if (email.isBlank()) {
            _state.update { it.copy(emailError = "Please enter your email address") }
            return
        }
        if (!currentState.isEmailValid) {
            _state.update { it.copy(emailError = "Please enter a valid email address") }
            return
        }

        _state.update { it.copy(isSubmitting = true, emailError = null) }
        billingManager.logIn(email)
        PayCraft.checkout(plan, email)
        viewModelScope.launch {
            _events.send(PayCraftPaywallEvent.CheckoutLaunched(url = plan.id))
        }
    }

    private fun onManageSubscription() {
        val email = _state.value.userEmail ?: return
        val supportEmail = _state.value.supportEmail
        PayCraft.manageSubscription(email)
        viewModelScope.launch {
            _events.send(PayCraftPaywallEvent.ManageLaunched(url = email))
        }
        Logger.d(TAG) { "Managing subscription for $email, support: $supportEmail" }
    }

    private fun onLogIn() {
        val email = _state.value.email.trim()
        if (email.isBlank()) {
            _state.update { it.copy(emailError = "Please enter your email address") }
            return
        }
        if (!_state.value.isEmailValid) {
            _state.update { it.copy(emailError = "Please enter a valid email address") }
            return
        }
        _state.update { it.copy(isSubmitting = true, emailError = null) }
        billingManager.logIn(email)
    }

    private fun onLogOut() {
        billingManager.logOut()
        _state.update { it.copy(email = "") }
    }

    private fun onDismiss() {
        viewModelScope.launch { _events.send(PayCraftPaywallEvent.Dismissed) }
    }

    private fun onRefreshStatus() {
        billingManager.refreshStatus()
    }

    private fun onContactSupport() {
        val supportEmail = _state.value.supportEmail
        if (supportEmail.isNotBlank()) {
            viewModelScope.launch {
                _events.send(PayCraftPaywallEvent.SupportEmailOpened(supportEmail))
            }
        }
    }

    private fun onClearError() {
        _state.update { it.copy(errorMessage = null) }
    }
}
