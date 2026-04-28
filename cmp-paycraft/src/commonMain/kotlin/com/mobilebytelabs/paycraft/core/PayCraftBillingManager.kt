package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.VerificationMethod
import com.mobilebytelabs.paycraft.network.OtpGateResult
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.provider.StripeProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PayCraftBillingManager(private val service: PayCraftService, private val store: PayCraftStore) : BillingManager {

    private val stripeMode: String
        get() = if ((PayCraft.config?.provider as? StripeProvider)?.isTestMode == true) "test" else "live"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _isPremium = MutableStateFlow(false)
    override val isPremium: StateFlow<Boolean> = _isPremium.asStateFlow()

    private val _subscriptionStatus = MutableStateFlow(SubscriptionStatus())
    override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus.asStateFlow()

    private val _billingState = MutableStateFlow<BillingState>(BillingState.Loading)
    override val billingState: StateFlow<BillingState> = _billingState.asStateFlow()

    private val _userEmail = MutableStateFlow<String?>(null)
    override val userEmail: StateFlow<String?> = _userEmail.asStateFlow()

    /**
     * Cached conflict info so that after OAuth or OTP verifies identity we can
     * re-hydrate OwnershipVerified without losing conflicting device details.
     * Cleared when conflict is resolved or user logs out.
     */
    private var lastConflict: BillingState.DeviceConflict? = null

    init {
        scope.launch {
            val savedEmail = store.getEmail()
            if (!savedEmail.isNullOrEmpty()) {
                _userEmail.value = savedEmail
                checkPremiumWithDeviceToken(savedEmail)
            } else {
                _billingState.value = BillingState.Free
            }
        }
    }

    override fun registerAndLogin(email: String) {
        val normalized = email.trim().lowercase()
        PayCraftLogger.onLogIn(normalized)
        _userEmail.value = normalized
        _billingState.value = BillingState.Loading
        scope.launch {
            store.saveEmail(normalized)
            performRegisterAndLogin(normalized)
        }
    }

    override fun logIn(email: String) = registerAndLogin(email)

    override fun refreshStatus() {
        val email = _userEmail.value
        PayCraftLogger.onRefreshStatus(email)
        if (email == null) {
            _billingState.value = BillingState.Free
            return
        }
        _billingState.value = BillingState.Loading
        scope.launch { checkPremiumWithDeviceToken(email) }
    }

    // ─── Gate 1: OAuth ────────────────────────────────────────────────────────

    override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) {
        // Capture conflict info before overwriting billingState with Loading
        val priorConflict = _billingState.value as? BillingState.DeviceConflict
            ?: lastConflict

        _billingState.value = BillingState.Loading

        val email = try {
            service.verifyOAuthToken(provider, idToken)
        } catch (e: Exception) {
            PayCraftLogger.onError("loginWithOAuth", e.message)
            _billingState.value = BillingState.Error(e.message ?: "OAuth verification failed")
            return
        }

        if (email == null) {
            _billingState.value = BillingState.Error("Could not verify your identity. Please try again.")
            return
        }

        val normalized = email.trim().lowercase()
        _userEmail.value = normalized
        scope.launch { store.saveEmail(normalized) }

        // If there's an active conflict and the verified email matches → ownership proven.
        // Emit OwnershipVerified so the UI shows the transfer confirmation dialog.
        val pendingToken = DeviceTokenStore.getToken()
        if (priorConflict != null &&
            pendingToken != null &&
            priorConflict.email.equals(normalized, ignoreCase = true)
        ) {
            _billingState.value = BillingState.OwnershipVerified(
                email = normalized,
                pendingToken = pendingToken,
                conflictingDeviceName = priorConflict.conflictingDeviceName,
                conflictingLastSeen = priorConflict.conflictingLastSeen,
                verifiedVia = VerificationMethod.OAUTH,
                supportEmail = PayCraft.config?.supportEmail ?: "",
            )
            return
        }

        // No prior conflict — treat as a fresh login
        performRegisterAndLogin(normalized)
    }

    // ─── Gate 2: OTP ──────────────────────────────────────────────────────────

    override suspend fun requestOtpVerification(email: String) {
        try {
            service.sendOtp(email)
        } catch (e: Exception) {
            PayCraftLogger.onError("requestOtpVerification", e.message)
        }
    }

    override suspend fun verifyOtpOwnership(email: String, otp: String): Boolean {
        val ok = try {
            service.verifyOtp(email, otp)
        } catch (e: Exception) {
            PayCraftLogger.onError("verifyOtpOwnership", e.message)
            false
        }

        if (ok) {
            val conflict = lastConflict
            val pendingToken = DeviceTokenStore.getToken()
            if (conflict != null && pendingToken != null) {
                _billingState.value = BillingState.OwnershipVerified(
                    email = email.trim().lowercase(),
                    pendingToken = pendingToken,
                    conflictingDeviceName = conflict.conflictingDeviceName,
                    conflictingLastSeen = conflict.conflictingLastSeen,
                    verifiedVia = VerificationMethod.OTP,
                    supportEmail = PayCraft.config?.supportEmail ?: "",
                )
            }
        }
        return ok
    }

    override suspend fun verifyOtp(email: String, otp: String): Boolean = try {
        service.verifyOtp(email, otp)
    } catch (e: Exception) {
        PayCraftLogger.onError("verifyOtp", e.message)
        false
    }

    // ─── Confirm transfer (after user confirms the dialog) ───────────────────

    override suspend fun confirmDeviceTransfer() {
        val state = _billingState.value as? BillingState.OwnershipVerified ?: return
        val email = state.email
        val token = state.pendingToken
        val mode = stripeMode

        _billingState.value = BillingState.Loading

        val ok = try {
            service.transferToDevice(email, token, mode)
        } catch (e: Exception) {
            PayCraftLogger.onError("confirmDeviceTransfer", e.message)
            false
        }

        if (ok) {
            lastConflict = null
            DeviceTokenStore.saveToken(token) // token is now ACTIVE
            checkPremiumWithDeviceToken(email)
        } else {
            _billingState.value = BillingState.Error("Transfer failed. Please try again or contact support.")
        }
    }

    // ─── Internal transfer (used by transferToDevice path) ───────────────────

    override suspend fun transferToDevice() {
        val email = _userEmail.value ?: return
        val token = DeviceTokenStore.getToken() ?: return
        val mode = stripeMode
        val ok = try {
            service.transferToDevice(email, token, mode)
        } catch (e: Exception) {
            false
        }
        if (ok) {
            lastConflict = null
            checkPremiumWithDeviceToken(email)
        }
    }

    override suspend fun revokeCurrentDevice() {
        val email = _userEmail.value ?: return
        val token = DeviceTokenStore.getToken() ?: return
        val mode = stripeMode
        try {
            service.revokeDevice(email, token, mode)
        } catch (e: Exception) { /* log */ }
        DeviceTokenStore.clearToken()
        _billingState.value = BillingState.Free
        _isPremium.value = false
    }

    override fun logOut() {
        PayCraftLogger.onLogOut()
        _userEmail.value = null
        _isPremium.value = false
        _subscriptionStatus.value = SubscriptionStatus()
        _billingState.value = BillingState.Free
        lastConflict = null
        scope.launch { store.clearEmail() }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private suspend fun performRegisterAndLogin(email: String) {
        val mode = stripeMode
        val platform = PlatformInfo.platform
        val deviceName = PlatformInfo.deviceName
        val deviceId = PlatformInfo.deviceId

        // Fast path: existing token already validated by server
        val existingToken = DeviceTokenStore.getToken()
        if (existingToken != null) {
            val check = try {
                service.checkPremiumWithDevice(email, existingToken, mode)
            } catch (e: Exception) {
                null
            }
            if (check?.tokenValid == true) {
                applyPremiumResult(email, check.isPremium, mode)
                return
            }
            // Token was revoked — clear and re-register below
            DeviceTokenStore.clearToken()
        }

        // Register this device with the server
        val reg = try {
            service.registerDevice(email, platform, deviceName, deviceId, mode)
        } catch (e: Exception) {
            PayCraftLogger.onError("registerDevice", e.message)
            _billingState.value = BillingState.Error(e.message ?: "Device registration failed")
            return
        }

        // Persist the server-issued token (even pending — stored for later activation)
        DeviceTokenStore.saveToken(reg.deviceToken)

        if (!reg.conflict) {
            checkPremiumWithDeviceToken(email)
        } else {
            val gate = try {
                service.checkOtpGate()
            } catch (e: Exception) {
                OtpGateResult(false, 0, 300)
            }
            val conflict = BillingState.DeviceConflict(
                email = email,
                pendingToken = reg.deviceToken,
                conflictingDeviceName = reg.conflictingDeviceName,
                conflictingLastSeen = reg.conflictingLastSeen,
                otpAvailable = gate.available,
                otpDailyLimit = gate.limit,
                supportEmail = PayCraft.config?.supportEmail ?: "",
            )
            lastConflict = conflict
            _billingState.value = conflict
        }
    }

    private suspend fun checkPremiumWithDeviceToken(email: String) {
        val token = DeviceTokenStore.getToken()
        val mode = stripeMode

        if (token == null) {
            performRegisterAndLogin(email)
            return
        }

        try {
            val result = service.checkPremiumWithDevice(email, token, mode)
            if (!result.tokenValid) {
                DeviceTokenStore.clearToken()
                performRegisterAndLogin(email)
                return
            }
            applyPremiumResult(email, result.isPremium, mode)
        } catch (e: Exception) {
            PayCraftLogger.onError("checkPremiumWithDeviceToken", e.message)
            _billingState.value = BillingState.Error(e.message ?: "Premium check failed")
        }
    }

    private suspend fun applyPremiumResult(email: String, isPremium: Boolean, mode: String) {
        _isPremium.value = isPremium
        if (isPremium) {
            val sub = try {
                service.getSubscription(email, mode)
            } catch (e: Exception) {
                null
            }
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
    }
}
