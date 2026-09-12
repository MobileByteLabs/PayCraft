package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.billing.NativePurchaseResult
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.TrialInfo
import com.mobilebytelabs.paycraft.model.VerificationMethod
import com.mobilebytelabs.paycraft.model.toSubscriptionStatus
import com.mobilebytelabs.paycraft.network.EntitlementDto
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.mobilebytelabs.paycraft.provider.StripeProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.mobilenativefoundation.store.store5.StoreReadResponse

/**
 * @param repo Optional Store5-backed [EntitlementRepository] (Phase 4). When wired (Android/iOS
 *   with the Phase-3 native client injected), [observeEntitlement]/[onForeground]/[onRestore]
 *   drive offline-correct, cache-first gating over the reconciled entitlement (D8, AC5/AC9). Left
 *   null on platforms/tests that gate purely through the legacy device-token path.
 */
class PayCraftBillingManager(
    private val service: PayCraftService,
    private val store: PayCraftStore,
    private val repo: EntitlementRepository? = null,
    private val nativeBillingClient: NativeBillingClient? = null,
) : BillingManager {

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

    private val _isInTrial = MutableStateFlow(false)
    override val isInTrial: StateFlow<Boolean> = _isInTrial.asStateFlow()

    private val _trialEndsAt = MutableStateFlow<String?>(null)
    override val trialEndsAt: StateFlow<String?> = _trialEndsAt.asStateFlow()

    /**
     * Backing flow for [subscriptionActivated].  replay=0 so late collectors
     * do not receive historical activations; extraBufferCapacity=1 ensures the
     * emit inside [applyPremiumResult] never suspends even if there is no active
     * collector at the exact moment of emission.
     */
    private val _subscriptionActivated = MutableSharedFlow<SubscriptionActivated>(
        replay = 0,
        extraBufferCapacity = 1,
    )
    override val subscriptionActivated: SharedFlow<SubscriptionActivated> =
        _subscriptionActivated.asSharedFlow()

    /**
     * Tracks the premium state observed during the most recent [applyPremiumResult]
     * call so we can detect the non-premium → premium rising edge and emit exactly once.
     * Initialised from the cached status so a warm-start re-apply does not re-fire.
     */
    private var lastObservedPremium: Boolean = store.getCachedSubscriptionStatus()?.isPremium ?: false

    /**
     * Cached conflict info so that after OAuth verifies identity we can
     * re-hydrate OwnershipVerified without losing conflicting device details.
     * Cleared when conflict is resolved or user logs out.
     */
    private var lastConflict: BillingState.DeviceConflict? = null

    init {
        // Attach the store's always-on purchase stream and sweep anything left unfinished BEFORE
        // any other init work: a purchase that completed while the app was dead must be reconciled
        // whether or not the user opens the paywall.
        observeOutOfBandPurchases()
        reconcileUnfinishedPurchases()

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
            PayCraft.refreshRealtimeIdentity() // re-bind entitlement channel to the new email (audit H3)
            performRegisterAndLogin(normalized)
        }
    }

    override fun logIn(email: String) = registerAndLogin(email)

    // ─── Native in-app-purchase lanes (Payments-policy / Guideline-3.1.1 compliance) ─────────────

    /** Canonical states that mean the entitlement is currently premium (grace = active, D6). */
    private val premiumCanonicalStates = setOf("trial", "active", "active_non_renewing", "in_grace_period")

    override fun purchaseViaPlayBilling(plan: BillingPlan, email: String?) = purchaseNative(
        tag = "purchaseViaPlayBilling",
        plan = plan,
        email = email,
        productId = plan.playProductId,
        storeLabel = "Play",
        notWiredError = "Google Play billing is not available on this device",
        misconfiguredError = "Google Play product not configured",
        // Google Play has a client-facing grant endpoint: register the purchaseToken server-side and
        // reflect the reconciled entitlement immediately.
        register = { purchase, resolvedProductId, appUserId ->
            service.registerPlayPurchase(
                purchaseToken = purchase.purchaseToken,
                productId = resolvedProductId,
                appUserId = appUserId,
                packageName = purchase.packageName.orEmpty(),
            )
        },
    )

    override fun purchaseViaStoreKit(plan: BillingPlan, email: String?) = purchaseNative(
        tag = "purchaseViaStoreKit",
        plan = plan,
        email = email,
        productId = plan.appStoreProductId,
        storeLabel = "StoreKit",
        notWiredError = "App Store billing is not available on this device",
        misconfiguredError = "App Store product not configured",
        // StoreKit now has a client-facing grant endpoint too (SK-4): post the signed transaction
        // to register-appstore, which JWS-verifies it and re-fetches authoritative status from the
        // App Store Server API. This removes the race where the client's reconcile read beat
        // Apple's ASSN-V2 webhook and the paywall reappeared straight after a successful payment.
        // ASSN-V2 keeps running as the async channel for renewals/refunds; both converge on the
        // same canonical record.
        register = { purchase, resolvedProductId, appUserId ->
            service.registerAppStorePurchase(
                signedTransaction = purchase.purchaseToken, // StoreKit JWS rides in purchaseToken
                appUserId = appUserId,
                productId = resolvedProductId,
            )
        },
    )

    /**
     * Shared native-purchase driver for both store lanes (Play Billing / StoreKit). Enforces the
     * SAME fail-closed anti-steering contract on both: a missing product id or an unwired native
     * client sets [BillingState.Error] and NEVER opens the web page.
     *
     * @param register optional server grant step (Play has one, StoreKit does not). When non-null and
     *   it returns a premium entitlement, premium is reflected immediately; when non-null and it
     *   returns null, the purchase is surfaced as "could not be verified". When null (StoreKit), the
     *   purchase reconciles purely through the server refresh path (ASSN-V2 already delivered truth).
     */
    private fun purchaseNative(
        tag: String,
        plan: BillingPlan,
        email: String?,
        productId: String?,
        storeLabel: String,
        notWiredError: String,
        misconfiguredError: String,
        register: (suspend (purchase: NativePurchase, productId: String, appUserId: String) -> EntitlementDto?)?,
    ) {
        // A lifetime plan is a ONE_TIME product on Play; everything else is a subscription. Without
        // this the store lookup asked for a SUBS product that does not exist and the purchase
        // failed with "Product not found".
        val productType = plan.nativeProductType
        val native = nativeBillingClient
        if (native == null) {
            // No native client wired (e.g. the platform billing module not loaded). Fail CLOSED with
            // an error — we do NOT fall back to the web page (that is the violation we prevent).
            PayCraftLogger.onError(
                tag,
                "no NativeBillingClient wired for ${plan.id} — load the platform billing module",
            )
            _billingState.value = BillingState.Error(notWiredError)
            return
        }

        if (productId.isNullOrBlank()) {
            // ANTI-STEERING KEYSTONE: a misconfigured product must NOT open the browser on a native store.
            PayCraftLogger.onError(
                tag,
                "product id missing for ${plan.id} — refusing web fallback (store anti-steering)",
            )
            _billingState.value = BillingState.Error(misconfiguredError)
            return
        }

        val appUserId = email?.trim()?.lowercase()?.ifBlank { null }
            ?: _userEmail.value
            ?: PayCraft.deviceId
        if (!email.isNullOrBlank()) _userEmail.value = email.trim().lowercase()

        _billingState.value = BillingState.Loading
        scope.launch {
            when (val result = native.purchase(productId, appUserId, productType)) {
                is NativePurchaseResult.Success -> {
                    val purchase = result.purchase
                    PayCraftLogger.onFlow(tag, "$storeLabel purchase OK (product=$productId)")

                    val entitlement = if (register != null) {
                        try {
                            register(purchase, productId, appUserId)
                        } catch (e: Exception) {
                            PayCraftLogger.onError(tag, "server register failed: ${e.message}")
                            null
                        }
                    } else {
                        null
                    }

                    // Reflect premium immediately from the server-reconciled entitlement (authoritative
                    // response). grace = active per D6.
                    val nowPremium = entitlement != null &&
                        entitlement.canonicalState.lowercase() in premiumCanonicalStates
                    if (nowPremium) {
                        val status = SubscriptionStatus(
                            isPremium = true,
                            plan = entitlement.productId,
                            email = _userEmail.value,
                            provider = entitlement.provider,
                            expiresAt = entitlement.expiresAt?.let { millisToIso(it) },
                            willRenew = entitlement.willRenew,
                        )
                        _isPremium.value = true
                        _subscriptionStatus.value = status
                        _billingState.value = BillingState.Premium(status)
                        store.cacheSubscriptionStatus(status)
                        if (!lastObservedPremium) {
                            _subscriptionActivated.emit(SubscriptionActivated(sku = status.plan, isTrial = false))
                        }
                        lastObservedPremium = true
                        // ONLY NOW is it safe to tell the store we are done with this purchase.
                        // Acknowledging/finishing earlier drops it from the store's unfinished
                        // queue, so a failed server call would leave a paying customer with no
                        // entitlement and nothing to retry against.
                        finishPurchaseSafely(native, purchase, tag)
                    } else if (register != null && entitlement == null) {
                        // A grant endpoint EXISTS but did not confirm — surface the failure.
                        _billingState.value = BillingState.Error(
                            "Purchase completed but could not be verified. Contact support if premium doesn't unlock.",
                        )
                    }

                    // Then reconcile through the normal server path so the entitlement fully lands.
                    if (_billingState.value is BillingState.Loading) {
                        // register == null (StoreKit): nothing set Premium/Error, so state is still
                        // Loading. refreshStatus() would skip on its Loading guard — reconcile directly
                        // instead so ASSN-V2-delivered truth is picked up.
                        val reconcileEmail = _userEmail.value
                        if (reconcileEmail != null) {
                            checkPremiumWithDeviceToken(reconcileEmail)
                        } else {
                            _billingState.value = if (_isPremium.value) {
                                BillingState.Premium(_subscriptionStatus.value)
                            } else {
                                BillingState.Free
                            }
                        }
                    } else {
                        // state is Premium/Error → refreshStatus re-checks server truth for the device.
                        refreshStatus(force = true)
                    }
                }

                is NativePurchaseResult.Pending -> {
                    // Money is in flight (cash / UPI mandate / Ask to Buy). NOT an error and NOT an
                    // entitlement — the resolution arrives later on purchaseUpdates, which
                    // [observeOutOfBandPurchases] is collecting.
                    PayCraftLogger.onFlow(
                        tag,
                        "$storeLabel purchase PENDING for $productId — awaiting payment clearance",
                    )
                    _billingState.value = BillingState.PaymentPending(productId)
                }

                NativePurchaseResult.Cancelled -> {
                    PayCraftLogger.onFlow(tag, "$storeLabel purchase cancelled by user")
                    // Return to the pre-purchase resting state rather than an error.
                    _billingState.value = if (_isPremium.value) {
                        BillingState.Premium(_subscriptionStatus.value)
                    } else {
                        BillingState.Free
                    }
                }

                is NativePurchaseResult.Failed -> {
                    PayCraftLogger.onError(tag, "$storeLabel purchase failed: ${result.message}")
                    _billingState.value = BillingState.Error(result.message)
                }
            }
        }
    }

    /**
     * Acknowledge/finish with the store, never letting a store failure break the user's session.
     * A failure leaves the purchase unacknowledged, which [reconcileUnfinishedPurchases] retries —
     * that retry is what stops Play auto-refunding it after 72 hours.
     */
    private suspend fun finishPurchaseSafely(native: NativeBillingClient, purchase: NativePurchase, tag: String) {
        try {
            native.finishPurchase(purchase)
        } catch (e: Exception) {
            PayCraftLogger.onError(tag, "finishPurchase failed (will retry on reconcile): ${e.message}")
        }
    }

    /**
     * Collect the store's ALWAYS-ON purchase stream for the SDK's lifetime.
     *
     * Everything that happens outside a foreground `purchase()` call lands here: renewals, promo
     * redemptions, deferred payments clearing days later, Ask-to-Buy approvals, family-sharing
     * grants, purchases that completed while the app was backgrounded, and StoreKit transactions
     * left unfinished by an earlier failed reconcile. Before this existed every one of those was
     * dropped and the buyer stayed un-upgraded until some later manual refresh.
     */
    private fun observeOutOfBandPurchases() {
        val native = nativeBillingClient ?: return
        scope.launch {
            native.purchaseUpdates.collect { purchase ->
                if (purchase.isPending) {
                    PayCraftLogger.onFlow(
                        "purchaseUpdates",
                        "pending purchase observed for ${purchase.productId} — not granting yet",
                    )
                    _billingState.value = BillingState.PaymentPending(purchase.productId)
                    return@collect
                }
                PayCraftLogger.onFlow(
                    "purchaseUpdates",
                    "out-of-band purchase observed for ${purchase.productId} — reconciling",
                )
                registerAndFinish(native, purchase, "purchaseUpdates")
            }
        }
    }

    /**
     * Re-drive any purchase the store still considers unfinished.
     *
     * Play returns unacknowledged purchases from `queryPurchasesAsync` and auto-refunds them after
     * 72 hours; StoreKit re-delivers unfinished transactions on `Transaction.updates`. Sweeping on
     * start and foreground turns a transient failure at exactly the wrong moment into a retry
     * instead of a silently refunded customer.
     */
    private fun reconcileUnfinishedPurchases() {
        val native = nativeBillingClient ?: return
        scope.launch {
            val purchases = try {
                native.queryPurchases()
            } catch (e: Exception) {
                PayCraftLogger.onError("reconcileUnfinished", e.message)
                return@launch
            }
            purchases.filter { !it.isAcknowledged && !it.isPending }.forEach { purchase ->
                PayCraftLogger.onFlow(
                    "reconcileUnfinished",
                    "unacknowledged purchase ${purchase.productId} — re-registering",
                )
                registerAndFinish(native, purchase, "reconcileUnfinished")
            }
        }
    }

    /** Register a store purchase server-side, then finish it with the store if that succeeded. */
    private suspend fun registerAndFinish(native: NativeBillingClient, purchase: NativePurchase, tag: String) {
        val appUserId = _userEmail.value ?: PayCraft.deviceId
        val platform = runCatching { PlatformInfo.platform.lowercase() }.getOrDefault("")
        val entitlement = try {
            when {
                platform == "android" -> service.registerPlayPurchase(
                    purchaseToken = purchase.purchaseToken,
                    productId = purchase.productId,
                    appUserId = appUserId,
                    packageName = purchase.packageName.orEmpty(),
                )
                platform == "ios" || platform == "macos" -> service.registerAppStorePurchase(
                    signedTransaction = purchase.purchaseToken,
                    appUserId = appUserId,
                    productId = purchase.productId,
                )
                else -> null
            }
        } catch (e: Exception) {
            PayCraftLogger.onError(tag, "server register failed — NOT finishing purchase: ${e.message}")
            return
        }

        if (entitlement == null) {
            // Both stores now have a grant endpoint, so a null here means the server did NOT
            // record the entitlement. Leave the purchase unfinished so the store keeps it in its
            // unfinished queue and the next reconcile retries it.
            PayCraftLogger.onError(tag, "server did not confirm ${purchase.productId} — leaving unfinished")
            refreshStatus(force = true)
            return
        }
        finishPurchaseSafely(native, purchase, tag)
        refreshStatus(force = true)
    }

    override suspend fun checkTrialEligibility(): Boolean {
        val token = DeviceTokenStore.getToken()
        if (token.isNullOrBlank()) {
            // No registered device — treat as eligible (first-time user).
            return true
        }
        return try {
            service.isTrialEligible(token)
        } catch (e: Exception) {
            PayCraftLogger.onError("checkTrialEligibility", e.message)
            // Optimistic on failure — server will reject at checkout if ineligible.
            true
        }
    }

    override fun refreshStatus(force: Boolean) {
        val email = _userEmail.value
        val currentState = _billingState.value
        PayCraftLogger.onRefreshStatus(email)

        // Never refresh over a conflict/verification/transfer flow — a concurrent
        // re-register would overwrite OwnershipVerified with DeviceConflict. These
        // stay protected even under force.
        // A `Loading` window is only skipped when NOT forced: a realtime entitlement
        // push (force=true) MUST still land during an in-flight refresh, otherwise the
        // live update is silently dropped and falls back to the slow TTL (audit H5).
        val protectedFlow = currentState is BillingState.DeviceConflict ||
            currentState is BillingState.OwnershipVerified
        val loadingSkip = currentState is BillingState.Loading && !force
        if (protectedFlow || loadingSkip) {
            PayCraftLogger.onFlow(
                "refreshStatus",
                "SKIPPED — active flow in progress (state=${currentState::class.simpleName}, force=$force)",
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
        scope.launch {
            store.saveEmail(normalized)
            PayCraft.refreshRealtimeIdentity()
        }

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
            PayCraftLogger.onError("transferToDevice", e.message)
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
        } catch (e: Exception) {
            PayCraftLogger.onError("revokeCurrentDevice", e.message)
        }
        DeviceTokenStore.clearToken()
        store.clearCache()
        _billingState.value = BillingState.Free
        _isPremium.value = false
    }

    override fun logOut() {
        PayCraftLogger.onLogOut()
        _userEmail.value = null
        _isPremium.value = false
        _isInTrial.value = false
        _trialEndsAt.value = null
        _subscriptionStatus.value = SubscriptionStatus()
        _billingState.value = BillingState.Free
        lastConflict = null
        store.clearCache()
        scope.launch {
            store.clearEmail()
            PayCraft.refreshRealtimeIdentity()
        } // drop old user's entitlement channel (audit M1)
    }

    // ─── Store5 entitlement gating (Phase 4 — cache-first + revalidate) ───────

    /**
     * Cache-first, offline-correct gating over the reconciled entitlement (AC9).
     *
     * Binds to the Store5 CACHED stream ([EntitlementRepository.stream]); every emission
     * re-derives premium from the offline last-known-good via
     * [EntitlementRepository.isServableOffline] (grace = active / retry = inactive, D6), so gating
     * survives a network outage without over-serving an expired/on-hold subscription. No-op when
     * [repo] is not wired (legacy device-token-only platforms/tests).
     */
    fun observeEntitlement(appUserId: String) {
        val repo = repo ?: return
        scope.launch {
            repo.stream(appUserId).collect { response ->
                val entitlement = (response as? StoreReadResponse.Data)?.value ?: return@collect
                val servable = repo.isServableOffline(entitlement, currentTimeMillis())
                _isPremium.value = servable
                val status = entitlement.toSubscriptionStatus(email = _userEmail.value)
                _subscriptionStatus.value = status
                _billingState.value = if (servable) BillingState.Premium(status) else BillingState.Free
                PayCraftLogger.onFlow(
                    "observeEntitlement",
                    "state=${entitlement.canonicalState::class.simpleName}, servableOffline=$servable",
                )
            }
        }
    }

    /**
     * Revalidate on app foreground — forces a fresh server reconcile through the Store5
     * FRESH sibling ([EntitlementRepository.streamFresh], S5-DUAL). No-op when [repo] is unwired.
     */
    fun onForeground(appUserId: String) {
        // A socket dropped during background still LOOKS present, so realtime would silently stay
        // dead and only the TTL fallback would remain. Force both channels to rebuild.
        PayCraft.resubscribeRealtime()
        // Foreground is the other moment a purchase may have resolved while we were not running
        // (a pending payment clearing, an Ask-to-Buy approval, an acknowledgement that failed
        // last session and is now inside Play's 72-hour auto-refund window).
        reconcileUnfinishedPurchases()
        val repo = repo ?: return
        scope.launch {
            repo.streamFresh(appUserId)
                .first { it is StoreReadResponse.Data || it is StoreReadResponse.Error }
        }
    }

    /**
     * Revalidate on restore — identity-linked cross-platform restore keyed by the stable
     * app-user-id ([EntitlementRepository.restore], AC5). No-op when [repo] is unwired.
     */
    suspend fun onRestore(appUserId: String) {
        repo?.restore(appUserId)
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
            PayCraftLogger.onFlow("performRegisterAndLogin", "→ CONFLICT detected")
            // No OTP budget probe here any more: the emailed-code gate was removed 2026-09-06, so
            // there is no per-day send budget to consult before deciding which gates to offer.
            val conflict = BillingState.DeviceConflict(
                email = email,
                pendingToken = reg.deviceToken,
                conflictingDeviceName = reg.conflictingDeviceName,
                conflictingLastSeen = reg.conflictingLastSeen,
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
        // Trial state not persisted in PayCraftStore cache today — derive from
        // server on next refresh. Conservative defaults until then.
        _isInTrial.value = false
        _trialEndsAt.value = null
        _billingState.value = if (cached.isPremium) {
            BillingState.Premium(cached)
        } else {
            BillingState.Free
        }
    }

    private fun buildTrialInfo(trialEnd: String?): TrialInfo? = computeTrialInfo(trialEnd, currentTimeMillis())

    /** Epoch-millis (EntitlementDto wire format) → ISO-8601 string (SubscriptionStatus format). */
    @OptIn(kotlin.time.ExperimentalTime::class)
    private fun millisToIso(ms: Long): String = kotlin.time.Instant.fromEpochMilliseconds(ms).toString()

    private suspend fun applyPremiumResult(email: String, isPremium: Boolean, mode: String) {
        PayCraftLogger.onFlow("applyPremiumResult", "email=$email, isPremium=$isPremium, mode=$mode")
        val wasAlreadyPremium = lastObservedPremium
        _isPremium.value = isPremium
        if (isPremium) {
            val token = DeviceTokenStore.getToken()
            val sub = try {
                if (token != null) service.getSubscription(token) else null
            } catch (e: Exception) {
                // Keep the premium fallback (status renders with null plan/expiry) but make
                // the swallowed failure observable — otherwise a premium user silently
                // renders with no plan/expiry and there is no signal in logs.
                PayCraftLogger.onError("applyPremiumResult", e.message)
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
            val trial = buildTrialInfo(sub?.trialEnd)
            _isInTrial.value = trial != null
            _trialEndsAt.value = trial?.endsAt
            _subscriptionStatus.value = status
            _billingState.value = BillingState.Premium(status, trial)
            store.cacheSubscriptionStatus(status)
            PayCraftLogger.onStatusResult(
                email = email,
                isPremium = true,
                plan = sub?.plan,
                provider = sub?.provider,
                expiresAt = sub?.currentPeriodEnd,
                willRenew = sub?.cancelAtPeriodEnd != true,
            )

            // Emit activation exactly once on the non-premium → premium rising edge.
            // Re-runs while already premium (e.g. background refreshes) are silently skipped.
            if (!wasAlreadyPremium) {
                PayCraftLogger.onFlow(
                    "applyPremiumResult",
                    "Rising edge detected → emitting subscriptionActivated " +
                        "(sku=${sub?.plan}, isTrial=${trial != null})",
                )
                scope.launch {
                    _subscriptionActivated.emit(
                        SubscriptionActivated(sku = sub?.plan, isTrial = trial != null),
                    )
                }
            }

            lastObservedPremium = true
        } else {
            val status = SubscriptionStatus(isPremium = false, email = email)
            _isInTrial.value = false
            _trialEndsAt.value = null
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
            lastObservedPremium = false
        }
    }
}
