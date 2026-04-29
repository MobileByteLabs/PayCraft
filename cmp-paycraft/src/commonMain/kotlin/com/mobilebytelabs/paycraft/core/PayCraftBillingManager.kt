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
        // Synchronous cache read — runs before any UI frame (no Loading flash)
        val cached = store.getCachedSubscriptionStatus()
        val lastSynced = store.getLastSyncedAt()
        if (cached != null) {
            applyCachedStatus(cached)
            PayCraftLogger.onFlow("init", "Cache hit: isPremium=${cached.isPremium}, lastSynced=$lastSynced")
        }

        // Async: email fetch (suspend) + conditional Supabase sync
        scope.launch {
            val savedEmail = store.getEmail()
            PayCraftLogger.onFlow("init", "savedEmail=${savedEmail ?: "null"}, stripeMode=$stripeMode")
            if (savedEmail.isNullOrEmpty()) {
                PayCraftLogger.onFlow("init", "No saved email → Free")
                _billingState.value = BillingState.Free
                return@launch
            }

            _userEmail.value = savedEmail

            if (cached == null) {
                // No cache — must fetch from Supabase
                PayCraftLogger.onFlow("init", "No cache → fetching from Supabase")
                checkPremiumWithDeviceToken(savedEmail)
            } else if (SyncPolicy.isSyncDue(cached, lastSynced)) {
                // Cache applied above — background sync only if due
                PayCraftLogger.onFlow("init", "Cache stale → background sync")
                checkPremiumWithDeviceToken(savedEmail)
            } else {
                PayCraftLogger.onFlow("init", "Cache fresh → skipping network call")
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

    override fun refreshStatus(force: Boolean) {
        val email = _userEmail.value
        val currentState = _billingState.value
        PayCraftLogger.onRefreshStatus(email)

        // Don't refresh while a conflict/verification/transfer flow is active —
        // the concurrent re-register would overwrite OwnershipVerified with DeviceConflict.
        if (currentState is BillingState.DeviceConflict ||
            currentState is BillingState.OwnershipVerified ||
            currentState is BillingState.Loading
        ) {
            PayCraftLogger.onFlow(
                "refreshStatus",
                "SKIPPED — active flow in progress (state=${currentState::class.simpleName})",
            )
            return
        }

        if (email == null) {
            _billingState.value = BillingState.Free
            return
        }

        // Smart sync: skip network if cache is fresh (unless force=true)
        if (!force) {
            val cached = store.getCachedSubscriptionStatus()
            val lastSynced = store.getLastSyncedAt()
            if (cached != null && !SyncPolicy.isSyncDue(cached, lastSynced)) {
                PayCraftLogger.onFlow("refreshStatus", "Cache fresh → skipping (force=false)")
                return
            }
        }

        _billingState.value = BillingState.Loading
        scope.launch { checkPremiumWithDeviceToken(email) }
    }

    // ─── Gate 1: OAuth ────────────────────────────────────────────────────────

    override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) {
        PayCraftLogger.onFlow("loginWithOAuth", "provider=$provider, idToken=${idToken.take(20)}...")
        // Capture conflict info before overwriting billingState with Loading
        val priorConflict = _billingState.value as? BillingState.DeviceConflict
            ?: lastConflict
        PayCraftLogger.onFlow(
            "loginWithOAuth",
            "priorConflict=${priorConflict != null}, lastConflict=${lastConflict != null}",
        )

        _billingState.value = BillingState.Loading

        val email = try {
            service.verifyOAuthToken(provider, idToken)
        } catch (e: Exception) {
            PayCraftLogger.onError("loginWithOAuth", e.message)
            _billingState.value = BillingState.Error(e.message ?: "OAuth verification failed")
            return
        }

        PayCraftLogger.onFlow("loginWithOAuth", "verifiedEmail=${email ?: "null"}")

        if (email == null) {
            PayCraftLogger.onFlow("loginWithOAuth", "→ Error: could not verify identity")
            _billingState.value = BillingState.Error("Could not verify your identity. Please try again.")
            return
        }

        val normalized = email.trim().lowercase()
        _userEmail.value = normalized
        scope.launch { store.saveEmail(normalized) }

        // If there's an active conflict and the verified email matches → ownership proven.
        val pendingToken = DeviceTokenStore.getToken()
        PayCraftLogger.onFlow(
            "loginWithOAuth",
            "pendingToken=${pendingToken?.take(
                20,
            )}, conflictEmail=${priorConflict?.email}, normalizedEmail=$normalized",
        )
        if (priorConflict != null &&
            pendingToken != null &&
            priorConflict.email.equals(normalized, ignoreCase = true)
        ) {
            PayCraftLogger.onFlow("loginWithOAuth", "→ OwnershipVerified (conflict match + token present)")
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
        PayCraftLogger.onFlow("loginWithOAuth", "→ No prior conflict, performing fresh register+login")
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
        // Try current billingState first; fall back to lastConflict + stored token if a race overwrote it
        var state = _billingState.value as? BillingState.OwnershipVerified
        PayCraftLogger.onFlow(
            "confirmDeviceTransfer",
            "currentState=${_billingState.value::class.simpleName}, isOwnershipVerified=${state != null}",
        )
        if (state == null && lastConflict != null) {
            // Race condition recovery: refreshStatus overwrote OwnershipVerified → DeviceConflict
            val token = DeviceTokenStore.getToken()
            PayCraftLogger.onFlow(
                "confirmDeviceTransfer",
                "Race recovery: lastConflict=${lastConflict != null}, storedToken=${token?.take(20)}",
            )
            if (token != null && lastConflict != null) {
                state = BillingState.OwnershipVerified(
                    email = lastConflict!!.email,
                    pendingToken = token,
                    conflictingDeviceName = lastConflict!!.conflictingDeviceName,
                    conflictingLastSeen = lastConflict!!.conflictingLastSeen,
                    verifiedVia = VerificationMethod.OAUTH,
                    supportEmail = lastConflict!!.supportEmail,
                )
                PayCraftLogger.onFlow("confirmDeviceTransfer", "→ Recovered OwnershipVerified from lastConflict")
            }
        }
        if (state == null) {
            PayCraftLogger.onFlow("confirmDeviceTransfer", "→ ABORT: no OwnershipVerified state available")
            return
        }
        val email = state.email
        val pendingToken = state.pendingToken
        // For transfer, the pending token itself serves as the server_token auth
        // (it was issued to this email during register_device)
        PayCraftLogger.onFlow("confirmDeviceTransfer", "email=$email, pendingToken=${pendingToken.take(20)}")

        _billingState.value = BillingState.Loading

        val ok = try {
            service.transferToDevice(pendingToken, pendingToken)
        } catch (e: Exception) {
            PayCraftLogger.onError("confirmDeviceTransfer", e.message)
            false
        }

        PayCraftLogger.onFlow("confirmDeviceTransfer", "transferResult=$ok")
        if (ok) {
            lastConflict = null
            DeviceTokenStore.saveToken(pendingToken) // token is now ACTIVE
            PayCraftLogger.onFlow("confirmDeviceTransfer", "→ Token saved, checking premium status...")
            checkPremiumWithDeviceToken(email)
        } else {
            PayCraftLogger.onFlow("confirmDeviceTransfer", "→ FAILED — showing error")
            _billingState.value = BillingState.Error("Transfer failed. Please try again or contact support.")
        }
    }

    // ─── Internal transfer (used by transferToDevice path) ───────────────────

    override suspend fun transferToDevice() {
        val email = _userEmail.value ?: return
        val token = DeviceTokenStore.getToken() ?: return
        val ok = try {
            service.transferToDevice(token, token)
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
        try {
            service.revokeDevice(token, token)
        } catch (e: Exception) { /* log */ }
        DeviceTokenStore.clearToken()
        store.clearCache()
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
        store.clearCache()
        scope.launch { store.clearEmail() }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private suspend fun performRegisterAndLogin(email: String) {
        val mode = stripeMode
        val platform = PlatformInfo.platform
        val deviceName = PlatformInfo.deviceName
        val deviceId = PlatformInfo.deviceId
        PayCraftLogger.onFlow(
            "performRegisterAndLogin",
            "email=$email, mode=$mode, platform=$platform, deviceName=$deviceName, deviceId=$deviceId",
        )

        // Fast path: existing token already validated by server
        val existingToken = DeviceTokenStore.getToken()
        PayCraftLogger.onFlow("performRegisterAndLogin", "existingToken=${existingToken?.take(20) ?: "null"}")
        if (existingToken != null) {
            val check = try {
                service.checkPremiumWithDevice(existingToken)
            } catch (e: Exception) {
                PayCraftLogger.onFlow("performRegisterAndLogin", "checkPremium exception: ${e.message}")
                null
            }
            PayCraftLogger.onFlow(
                "performRegisterAndLogin",
                "fastPath check: tokenValid=${check?.tokenValid}, isPremium=${check?.isPremium}",
            )
            if (check?.tokenValid == true) {
                PayCraftLogger.onFlow("performRegisterAndLogin", "→ Fast path: token valid, applying result")
                applyPremiumResult(email, check.isPremium, mode)
                return
            }
            // Token was revoked — clear and re-register below
            PayCraftLogger.onFlow("performRegisterAndLogin", "→ Token invalid/revoked, clearing and re-registering")
            DeviceTokenStore.clearToken()
        }

        // Register this device with the server
        PayCraftLogger.onFlow("performRegisterAndLogin", "Calling registerDevice...")
        val reg = try {
            service.registerDevice(email, platform, deviceName, deviceId, mode)
        } catch (e: Exception) {
            PayCraftLogger.onError("registerDevice", e.message)
            _billingState.value = BillingState.Error(e.message ?: "Device registration failed")
            return
        }

        PayCraftLogger.onFlow(
            "performRegisterAndLogin",
            "registerDevice result: token=${reg.deviceToken.take(
                20,
            )}, conflict=${reg.conflict}, conflictDevice=${reg.conflictingDeviceName}",
        )

        // Persist the server-issued token (even pending — stored for later activation)
        DeviceTokenStore.saveToken(reg.deviceToken)

        if (!reg.conflict) {
            PayCraftLogger.onFlow("performRegisterAndLogin", "→ No conflict, checking premium...")
            checkPremiumWithDeviceToken(email)
        } else {
            PayCraftLogger.onFlow("performRegisterAndLogin", "→ CONFLICT detected! Checking OTP gate...")
            val gate = try {
                service.checkOtpGate()
            } catch (e: Exception) {
                PayCraftLogger.onFlow("performRegisterAndLogin", "OTP gate error: ${e.message}")
                OtpGateResult(false, 0, 300)
            }
            PayCraftLogger.onFlow(
                "performRegisterAndLogin",
                "OTP gate: available=${gate.available}, sendsToday=${gate.sendsToday}",
            )
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
            PayCraftLogger.onFlow("performRegisterAndLogin", "→ Setting BillingState.DeviceConflict")
            _billingState.value = conflict
        }
    }

    private suspend fun checkPremiumWithDeviceToken(email: String) {
        val token = DeviceTokenStore.getToken()
        val mode = stripeMode
        PayCraftLogger.onFlow(
            "checkPremiumWithDeviceToken",
            "email=$email, token=${token?.take(20) ?: "null"}, mode=$mode",
        )

        if (token == null) {
            PayCraftLogger.onFlow("checkPremiumWithDeviceToken", "→ No token, performing register+login")
            performRegisterAndLogin(email)
            return
        }

        try {
            val result = service.checkPremiumWithDevice(token)
            PayCraftLogger.onFlow(
                "checkPremiumWithDeviceToken",
                "result: isPremium=${result.isPremium}, tokenValid=${result.tokenValid}",
            )
            if (!result.tokenValid) {
                PayCraftLogger.onFlow("checkPremiumWithDeviceToken", "→ Token invalid, clearing and re-registering")
                DeviceTokenStore.clearToken()
                performRegisterAndLogin(email)
                return
            }
            PayCraftLogger.onFlow("checkPremiumWithDeviceToken", "→ Token valid, applying premium result")
            applyPremiumResult(email, result.isPremium, mode)
        } catch (e: Exception) {
            PayCraftLogger.onError("checkPremiumWithDeviceToken", e.message)
            _billingState.value = BillingState.Error(e.message ?: "Premium check failed")
        }
    }

    private fun applyCachedStatus(cached: SubscriptionStatus) {
        _isPremium.value = cached.isPremium
        _subscriptionStatus.value = cached
        _billingState.value = if (cached.isPremium) {
            BillingState.Premium(cached)
        } else {
            BillingState.Free
        }
    }

    private suspend fun applyPremiumResult(email: String, isPremium: Boolean, mode: String) {
        PayCraftLogger.onFlow("applyPremiumResult", "email=$email, isPremium=$isPremium, mode=$mode")
        _isPremium.value = isPremium
        if (isPremium) {
            val token = DeviceTokenStore.getToken()
            val sub = try {
                if (token != null) service.getSubscription(token) else null
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
            store.cacheSubscriptionStatus(status)
            PayCraftLogger.onStatusResult(
                email = email,
                isPremium = true,
                plan = sub?.plan,
                provider = sub?.provider,
                expiresAt = sub?.currentPeriodEnd,
                willRenew = sub?.cancelAtPeriodEnd != true,
            )
        } else {
            val status = SubscriptionStatus(isPremium = false, email = email)
            _subscriptionStatus.value = status
            _billingState.value = BillingState.Free
            store.cacheSubscriptionStatus(status)
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
