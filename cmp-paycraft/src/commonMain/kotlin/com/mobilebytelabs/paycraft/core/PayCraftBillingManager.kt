package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PayCraftBillingManager(private val service: PayCraftService, private val store: PayCraftStore) : BillingManager {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _isPremium = MutableStateFlow(false)
    override val isPremium: StateFlow<Boolean> = _isPremium.asStateFlow()

    private val _subscriptionStatus = MutableStateFlow(SubscriptionStatus())
    override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus.asStateFlow()

    private val _billingState = MutableStateFlow<BillingState>(BillingState.Loading)
    override val billingState: StateFlow<BillingState> = _billingState.asStateFlow()

    private val _userEmail = MutableStateFlow<String?>(null)
    override val userEmail: StateFlow<String?> = _userEmail.asStateFlow()

    init {
        scope.launch {
            val savedEmail = store.getEmail()
            if (!savedEmail.isNullOrEmpty()) {
                _userEmail.value = savedEmail
                checkPremiumStatus(savedEmail)
            } else {
                _billingState.value = BillingState.Free
            }
        }
    }

    override fun refreshStatus() {
        val email = _userEmail.value
        PayCraftLogger.onRefreshStatus(email)
        if (email == null) {
            _billingState.value = BillingState.Free
            return
        }
        scope.launch { checkPremiumStatus(email) }
    }

    override fun logIn(email: String) {
        val normalized = email.trim().lowercase()
        PayCraftLogger.onLogIn(normalized)
        _userEmail.value = normalized
        _billingState.value = BillingState.Loading
        scope.launch {
            store.saveEmail(normalized)
            checkPremiumStatus(normalized)
        }
    }

    override fun logOut() {
        PayCraftLogger.onLogOut()
        _userEmail.value = null
        _isPremium.value = false
        _subscriptionStatus.value = SubscriptionStatus()
        _billingState.value = BillingState.Free
        scope.launch { store.clearEmail() }
    }

    private suspend fun checkPremiumStatus(email: String) {
        try {
            val premium = service.isPremium(email)
            _isPremium.value = premium

            if (premium) {
                val sub = service.getSubscription(email)
                val status = SubscriptionStatus(
                    isPremium = true,
                    plan = sub?.plan,
                    email = email,
                    provider = sub?.provider,
                    expiresAt = sub?.currentPeriodEnd,
                    willRenew = sub?.cancelAtPeriodEnd != true,
                )
                _subscriptionStatus.value = status
                _billingState.value = BillingState.Premium(status)
                PayCraftLogger.onStatusResult(
                    email = email,
                    isPremium = true,
                    plan = sub?.plan,
                    provider = sub?.provider,
                    expiresAt = sub?.currentPeriodEnd,
                    willRenew = sub?.cancelAtPeriodEnd != true,
                )
            } else {
                _subscriptionStatus.value = SubscriptionStatus(isPremium = false, email = email)
                _billingState.value = BillingState.Free
                PayCraftLogger.onStatusResult(
                    email = email,
                    isPremium = false,
                    plan = null,
                    provider = null,
                    expiresAt = null,
                    willRenew = false,
                )
            }
        } catch (e: Exception) {
            PayCraftLogger.onError(source = "checkPremiumStatus", message = e.message)
            _billingState.value = BillingState.Error(e.message ?: "Unknown error")
        }
    }
}
