/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.core.EntitlementSnapshot
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.core.SubscriptionActivated
import com.mobilebytelabs.paycraft.core.TrialSnapshot
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.EntitlementSummary
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.CouponClient
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The ONE data surface a consumer app needs from PayCraft.
 *
 * ## Why this exists
 *
 * Every consumer was hand-writing this. Measured on `mbs/cappy` 2026-10-07: 670 LOC across five
 * modules (`core/network` 306, `feature/paycraft` 241, `core/data` 87, `core/store` 36), of which
 * `PayCraftApiImpl` alone was 233 lines holding **12** SDK call sites — roughly 95% type translation,
 * not logic. The framework rule of the day actively required that wrapper, to keep the SDK
 * "swappable". Swappability is a non-goal for a first-party SDK, and `PUBLIC_API.md` says so: every
 * consumer of this SDK is ours and they are updated directly. So the wrapper was a premium paid per
 * consumer for an option nobody would exercise.
 *
 * ## What it is
 *
 * A FACADE over surfaces this SDK already owns — [com.mobilebytelabs.paycraft.core.BillingManager],
 * [com.mobilebytelabs.paycraft.core.EntitlementRepository] and the config flows. It introduces no new
 * concept and owns no state. Consumers inject it from Koin ([com.mobilebytelabs.paycraft.di.payCraftModule])
 * and need no repository of their own.
 *
 * ## What stays internal, deliberately
 *
 * `EntitlementRepository` (the Store5 layer) and `PayCraftService` (networking) are NOT re-exposed
 * here. `EntitlementRepository` threads an `appUserId` and speaks `StoreReadResponse<Entitlement>`;
 * making a consumer handle either is the plumbing this facade exists to hide, and `PUBLIC_API.md`
 * forbids a consumer reaching the provider/network path at all.
 *
 * @see com.mobilebytelabs.paycraft.ui.PayCraftPremiumGuard for the Compose gate that consumes this.
 */
interface PayCraftRepository {

    /**
     * THE gating signal. Bind UI visibility to this and nothing else.
     *
     * Offline-tolerant by construction: it is fed from the Store5 cached read, so a user who paid
     * stays premium when the network is gone (the core-loop-never-blocked invariant).
     */
    val isPremium: StateFlow<Boolean>

    /**
     * Where a purchase currently is. `PaymentPending` is NOT a failure — some providers settle
     * asynchronously, and treating it as one is the mistake `BILLING_STATE_SEMANTICS.md` was written
     * to stop.
     */
    val billingState: StateFlow<BillingState>

    /** Tier + expiry detail, for a settings row that shows more than a boolean. */
    val subscriptionStatus: StateFlow<SubscriptionStatus>

    /** Separate from [isPremium] on purpose: trialing users are premium but convert differently. */
    val isInTrial: StateFlow<Boolean>

    /**
     * The gating value — tier + sub-tier role + trial end, in one object.
     *
     * Prefer this over [billingState] for GATING. `BillingState` describes where a purchase IS
     * (Loading / PaymentPending / Error / DeviceConflict…), which is the right shape for a checkout
     * flow and the wrong one for "can this user open the premium pack?". [EntitlementSummary] folds
     * the process states in so they PRESERVE the previous tier rather than reading FREE — a payment
     * settling must never show the paywall to someone who already paid.
     *
     * [EntitlementSummary.roleIdentifier] carries the package role, so an app with several paid tiers
     * derives its own notion from tenant configuration instead of hardcoding product names.
     */
    val entitlement: StateFlow<EntitlementSummary>

    /**
     * Purchasable plans, newest config wins.
     *
     * A flow, where `PayCraft.plans` is a plain `List`, because a paywall opened before the first
     * `/config` lands would otherwise render empty forever with no way to recover. Projected from the
     * existing `suiteConfigFlow` — no new SDK state.
     */
    val plans: StateFlow<List<BillingPlan>>

    /**
     * Server-authoritative consumable balances by sku (coins, credits, gems).
     *
     * READ-ONLY with no local increment path (AR-013) — a client-writable balance is forgeable
     * currency. An absent sku has not been read yet; that is NOT a zero balance.
     */
    val balances: StateFlow<Map<String, Int>>

    /**
     * Skus owned outright (one-time unlocks). Server-confirmed only — a sku appears here when the
     * server says so, never optimistically on a purchase return (AR: `owns` is false until the
     * server confirms the grant).
     */
    val ownedSkus: StateFlow<Set<String>>

    /**
     * Start checkout. **Fire-and-observe**, matching `PayCraft.checkout`: it routes to the correct
     * lane (native store vs web) and returns immediately.
     *
     * It does NOT return a result, because there is no synchronous verdict to return — a
     * `Result<Unit>` here would be a lie. Observe [billingState] for the outcome.
     *
     * Never opens a web checkout for a digital good on Android/iOS; the lane resolution owns that
     * and fails closed rather than committing an anti-steering violation.
     */
    /** Re-read [sku]'s balance from the server into [balances]; 0 when it cannot be read. */
    suspend fun refreshBalance(sku: String): Int

    /** Re-read ownership of [sku] into [ownedSkus]; false when it cannot be read. */
    suspend fun refreshOwnership(sku: String): Boolean

    /**
     * Spend [quantity] of [sku], server-checked and atomic.
     *
     * [idempotencyKey] is REQUIRED (AR-011) so a retry after a timeout replays rather than charges
     * twice. Insufficient funds is a [Result.failure], not an exception (AR-012).
     */
    suspend fun spend(sku: String, quantity: Int, idempotencyKey: String): Result<Int>

    /**
     * Report an in-app ACTIVITY earn (a completed session, a streak) and return the new balance.
     *
     * [eventId] is the idempotency key: it must identify the activity, not the call, or a retry
     * pays twice. The server CLAMPS to the tenant's daily cap, so the result may be lower than
     * balance+quantity — an honest client at its ceiling, not an error.
     *
     * Activity earns are client-asserted by construction (no server can observe a focus session),
     * which is exactly why the ceiling is enforced server-side.
     */
    suspend fun earn(sku: String, quantity: Int, eventId: String): Int

    fun checkout(plan: BillingPlan, email: String? = null)

    /**
     * Re-grant a previously-purchased entitlement on this device/account.
     *
     * Suspending and result-bearing, unlike [checkout], because restore genuinely has a synchronous
     * answer. `appUserId` is resolved internally (`email ?: deviceId`) so the consumer never
     * constructs one.
     */
    suspend fun restore(): Entitlement

    /**
     * Open wherever this user's subscription is actually managed: the provider's portal when one
     * exists, else the platform's own store subscriptions page.
     *
     * [email] is OPTIONAL and must stay optional. A store-billed subscriber is identified by their
     * store account, which PayCraft knows nothing about — so a non-null parameter here made the
     * commonest case inexpressible through this facade and sent every caller back to the singleton.
     */
    fun manageSubscription(email: String? = null)

    /**
     * The destination [manageSubscription] would open, or `null` when there is nowhere to send this
     * user (a desktop/web build with no store page and no provider portal).
     *
     * Exposed so a host can decide whether to SHOW a "Manage subscription" affordance at all,
     * rather than rendering a row that does nothing when tapped.
     */
    fun manageSubscriptionUrl(email: String? = null): String?

    /** Re-read entitlement. `force = true` bypasses the cache — use on foreground and post-purchase. */
    fun refresh(force: Boolean = false)

    // ── Ad-free entitlement ──────────────────────────────────────────────────────────────────────

    /**
     * Whether ads should be suppressed for this user.
     *
     * A SEPARATE signal from [isPremium] on purpose: a host may grant an ad-free cohort that never
     * subscribed (AC-12). Gate ad rendering on this, never on [isPremium], or a granted user still
     * sees ads. The SDK's own gates already treat `isPremium || isAdFree` as entitled.
     */
    val isAdFree: StateFlow<Boolean>

    // ── Coupons ──────────────────────────────────────────────────────────────────────────────────

    /**
     * Validate a coupon code against a plan, returning the server's verdict.
     *
     * Suspending and result-bearing because a coupon genuinely has a synchronous answer — unlike
     * checkout, whose outcome only arrives through [billingState]. Validating does NOT apply it;
     * pass the accepted coupon to [setAppliedCoupon] for the paywall to price with it.
     */
    suspend fun applyCoupon(planId: String, code: String): CouponClient.Result

    /**
     * Attach an already-validated coupon to a plan so the paywall prices it with the discount.
     *
     * `null` clears it. Separate from [applyCoupon] because validation and application are distinct
     * steps: a host may validate once and apply to several plans, or clear without re-validating.
     */
    fun setAppliedCoupon(planId: String, coupon: CouponDto?)

    // ── Paywall presentation ─────────────────────────────────────────────────────────────────────
    //
    // On the DATA facade, not the network one: a feature observes this to render a paywall, and a
    // feature talks to core/data. Nothing here reaches the server — the SDK's gates and
    // PayCraftPaywallComposable drive these same members internally, so a host using them needs
    // none of this directly.

    /** Whether the SDK currently wants a paywall on screen, and why. */
    val paywallPresentation: StateFlow<PaywallPresentation>

    /** Present the paywall now — the manual/contextual trigger (a "Get Premium" button). */
    fun presentPaywall()

    /**
     * Present the paywall only if the user is not already entitled.
     *
     * A no-op for an entitled buyer, which is what makes it safe to call from a gate without
     * checking first — and what stops a paying customer seeing a paywall on a race.
     */
    fun presentPaywallIfNeeded(entitlement: String? = null)

    /** Dismiss it. Pair with whatever the host used to show it. */
    fun dismissPaywall()

    /**
     * Report app-foreground state: resync the ad-free flag and present the paywall if the tenant's
     * monetization mode says this is the moment.
     *
     * ONE call rather than two because the two must not disagree. It sets [isAdFree] from the
     * snapshot up-front, then decides about the paywall — so a host cannot resync entitlement and
     * forget the presentation half, or present a paywall against a stale ad-free flag. A premium
     * user is never nagged regardless of trial state.
     */
    fun onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot)

    // ── Identity ─────────────────────────────────────────────────────────────────────────────────
    //
    // An entitlement belongs to a PERSON, so a host with accounts must tell the SDK who is signed
    // in. This used to require reaching for `PayCraft.billingManager`, which handed a consumer the
    // whole internal engine — purchase launching, device transfer, OAuth — to accomplish a one-line
    // identity bind. `billingManager` is now `internal`; this is the sanctioned surface.

    /** Who the SDK currently believes is signed in. `null` before any [logIn]. */
    val userEmail: StateFlow<String?>

    /**
     * Bind the entitlement to this person, and re-resolve it.
     *
     * Call on sign-in AND on every identity change — a sign-out/sign-in as a different user must
     * re-point the entitlement, or the second user inherits the first one's premium.
     */
    fun logIn(email: String)

    /**
     * Clear the signed-in identity and drop to anonymous.
     *
     * The entitlement goes with it: a sign-out that leaves a cached premium state shows the next
     * user something they did not buy.
     */
    fun logOut()

    /**
     * Bind identity from an OAuth provider's id token, for hosts that never see an email.
     *
     * Suspending because it round-trips to verify the token before the identity is trusted.
     */
    suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String)

    /**
     * Whether this user may still start a free trial.
     *
     * Ask BEFORE advertising one: a returning user who already consumed their trial is shown the
     * offer, taps it, and the store refuses — a dead end the host could have avoided.
     */
    suspend fun checkTrialEligibility(): Boolean

    /**
     * One-shot purchase-success events, for an effect a flow of state cannot express: a thank-you
     * sheet, a confetti burst, an analytics conversion. [isPremium] tells you the user IS premium;
     * this tells you they JUST became premium.
     */
    val subscriptionActivated: SharedFlow<SubscriptionActivated>

    // ── Device conflict ──────────────────────────────────────────────────────────────────────────
    //
    // One subscription, one active device. When a user signs in on a second phone the SDK emits
    // [BillingState.OwnershipVerified] — ownership is proven, but the entitlement still lives on
    // the OLD device — and the host must ask before moving it.
    //
    // These two were the LAST reason a consumer had to reach past this facade to BillingManager: the
    // conflict is a state a host necessarily renders, and resolving it was unreachable from here. A
    // facade missing the actions for a state it exposes is not a facade.

    /**
     * Move the subscription to THIS device, after the user confirms.
     *
     * Call only in response to [BillingState.OwnershipVerified] and only on an explicit
     * confirmation — it DEACTIVATES the other device, so a user who taps by accident loses access
     * on the phone in their other hand. On success [billingState] emits [BillingState.Premium].
     */
    suspend fun confirmDeviceTransfer()

    /**
     * Un-register this device, releasing the subscription slot.
     *
     * The other half of the conflict flow: a user who decides the OTHER device should keep the
     * subscription. Also what a "sign out of this device" affordance calls. The user must
     * re-register to become entitled here again.
     */
    suspend fun revokeCurrentDevice()
}
