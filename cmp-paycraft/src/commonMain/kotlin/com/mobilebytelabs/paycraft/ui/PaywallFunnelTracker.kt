package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.analytics.AttemptTracker
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftFailure
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.notify.ResumeNudgeTrigger
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.platform.currentTimeMillis

/**
 * Turns what happens in the paywall into catalog events (paycraft-paywall-analytics, GOAL AC-2).
 *
 * It remembers the step the buyer is on — paywall → plan → payment method → checkout, with sign-in and the
 * device limit along the way — so when they leave, [abandoned] reports WHERE they left, with the plan,
 * currency, provider and what opened the paywall. The ViewModel calls it at each transition; events go to
 * [PayCraft.analytics] (the app's listener + PayCraft's funnel) unless a test hands in [emit].
 *
 * It also carries the PURCHASE ATTEMPT (paycraft-attempt-observability D4, AC-9): picking a plan opens one on
 * [attempts] (switching plans closes the previous as abandoned), and from then on every event of this paywall carries
 * its id — the same id the checkout request and the store purchase carry. Leaving at checkout, or a premium arrival,
 * ends it; leaving at checkout also lets the SDK schedule its resume reminder ([attemptEnded]).
 */
internal class PaywallFunnelTracker(
    private val emit: (PayCraftEvent) -> Unit = { PayCraft.analytics.emit(it) },
    private val now: () -> Long = { currentTimeMillis() },
    private val attempts: AttemptTracker = PayCraft.attemptTracker,
    private val attemptEnded: (ResumeNudgeTrigger) -> Unit = { PayCraft.onAttemptEnded(it) },
) {
    /** The step the buyer is on now — where an abandon is recorded. */
    var step: PayCraftStep = PayCraftStep.Paywall
        private set
    private var sku: String? = null
    private var currency: String? = null
    private var provider: String? = null
    private var checkoutStarted = false
    private var purchased = false
    private var showing = false

    /** The attempt this showing's events belong to — none until a plan is picked (or a reminder reopened one). */
    private var attemptId: String? = null

    /** A hosted checkout page (browser / Custom Tab) was opened and the buyer has not come back from it yet. */
    var awaitingCheckoutReturn = false
        private set

    /** What opened this paywall — resolved once when it is shown, so every event of the funnel carries the same one. */
    private var trigger: String = "direct"

    /**
     * The placement the app (or an SDK entry point) named for THIS paywall, else how the SDK presented it. The
     * placement is consumed here: a value left over from an earlier open must not label the next one.
     */
    private fun resolveTrigger(): String {
        val placement = PayCraft.paywallPlacement?.takeIf { it.isNotBlank() }
        PayCraft.paywallPlacement = null
        return placement
            ?: when (val p = PayCraft.paywallPresentation.value) {
                is PaywallPresentation.Shown -> when (p.trigger) {
                    PaywallPresentation.Shown.Trigger.Manual -> "manual"
                    PaywallPresentation.Shown.Trigger.IfNeeded -> "if_needed"
                    PaywallPresentation.Shown.Trigger.TrialManagedAppOpen -> "trial_app_open"
                    PaywallPresentation.Shown.Trigger.ResumeNudge -> "resume_nudge"
                }
                PaywallPresentation.Hidden -> "direct"
            }
    }

    private fun send(
        name: PayCraftEventName,
        step: PayCraftStep = this.step,
        reason: String? = null,
        failure: PayCraftFailure? = null,
    ) {
        val experiment = runCatching { PayCraft.activeExperiment }.getOrNull()
        emit(
            PayCraftEvent(
                name = name, step = step,
                platform = runCatching { PlatformInfo.platform.lowercase() }.getOrDefault("android"),
                trigger = trigger, sku = sku, currency = currency,
                country = runCatching { PayCraft.activeCountry }.getOrNull(),
                provider = provider, reason = reason, atMs = now(),
                experiment = experiment?.experiment, variant = experiment?.variant,
                attemptId = attemptId, failure = failure,
            ),
        )
    }

    /** Joins (or opens) the attempt for [plan] — the plan pick and everything after it share one id. */
    private fun attemptFor(plan: BillingPlan) {
        attemptId = attempts.ensure(plan.sku)
    }

    /** The paywall appeared (each time it is shown — the ViewModel outlives the sheet). */
    fun shown() {
        step = PayCraftStep.Paywall
        trigger = resolveTrigger()
        provider = null
        checkoutStarted = false
        purchased = false
        showing = true
        // A paywall the resume reminder raised continues the attempt it reminded about; any other starts with none.
        attemptId = if (trigger == "resume_nudge") attempts.current else null
        send(PayCraftEventName.PaywallView)
    }

    fun planSelected(plan: BillingPlan) {
        sku = plan.sku
        currency = plan.currency
        step = PayCraftStep.Plan
        attemptFor(plan)
        send(PayCraftEventName.PlanSelect)
    }

    fun providerSheetShown(plan: BillingPlan) {
        attemptFor(plan)
        sku = plan.sku
        currency = plan.currency
        step = PayCraftStep.Provider
        send(PayCraftEventName.ProviderView)
    }

    /** The payment-method sheet closed without a choice: an abandon there; the buyer is back at the plan. */
    fun providerSheetDismissed() {
        send(PayCraftEventName.StepAbandon, PayCraftStep.Provider)
        step = PayCraftStep.Plan
    }

    fun providerChosen(plan: BillingPlan, providerId: String) {
        attemptFor(plan)
        sku = plan.sku
        currency = plan.currency
        provider = providerId
        step = PayCraftStep.Provider
        send(PayCraftEventName.ProviderSelect)
    }

    fun checkoutStarted(plan: BillingPlan, providerId: String?) {
        attemptFor(plan)
        sku = plan.sku
        currency = plan.currency
        if (providerId != null) provider = providerId
        step = PayCraftStep.Checkout
        checkoutStarted = true
        send(PayCraftEventName.CheckoutStart)
    }

    /** The checkout could not start or failed — reported with its structured [failure] (stage, class, code). */
    fun purchaseFailed(failure: PayCraftFailure) =
        send(PayCraftEventName.PurchaseFail, reason = failure.code, failure = failure)

    /** A hosted checkout page opened; the buyer's return to the app is reported by [checkoutReturned]. */
    fun hostedCheckoutLaunched() {
        awaitingCheckoutReturn = true
    }

    /**
     * The buyer came back from a hosted checkout page (web redirect, Custom Tab). [result] is `success` when premium
     * had already arrived, else `unconfirmed` — a webhook can still grant it, which `purchase_success` then reports.
     * Once per launched checkout.
     */
    fun checkoutReturned(result: String) {
        awaitingCheckoutReturn = false
        send(PayCraftEventName.CheckoutReturn, PayCraftStep.Checkout, reason = result)
    }

    /** Premium arrived. Counted once, and only for a checkout started from this paywall. */
    fun purchaseSucceeded(planId: String?) {
        if (purchased || !checkoutStarted) return
        purchased = true
        // The checkout already set the catalogue SKU; a store status reports its OWN id (`pro_quarterly`),
        // which no dashboard row is keyed on. Only fall back to it when the checkout left no SKU.
        if (sku == null) sku = planId
        send(PayCraftEventName.PurchaseSuccess)
        attempts.granted()
    }

    fun signInShown(providerId: String) {
        step = PayCraftStep.SignIn
        send(PayCraftEventName.SignInView, reason = providerId)
    }

    fun signInCompleted() {
        if (step != PayCraftStep.SignIn) return
        send(PayCraftEventName.SignInComplete)
    }

    fun deviceLimitShown() {
        step = PayCraftStep.DeviceLimit
        send(PayCraftEventName.DeviceLimitView)
    }

    /** The exit survey appeared after an abandon at [atStep]. */
    fun surveyShown(atStep: PayCraftStep) = send(PayCraftEventName.SurveyView, atStep)

    fun surveyAnswered(reasonCode: String) =
        send(PayCraftEventName.SurveyAnswer, PayCraftStep.Survey, reason = reasonCode)

    fun offerShown(percentOff: Int) = send(PayCraftEventName.OfferView, PayCraftStep.Offer, reason = "${percentOff}pct")

    /** The buyer claimed the offer: they are back in the buying path, so a later close is a new abandon. */
    fun offerAccepted() {
        send(PayCraftEventName.OfferAccept, PayCraftStep.Offer)
        showing = true
        step = PayCraftStep.Checkout
    }

    /** The buyer turned the win-back offer down ("No thanks"). */
    fun offerDeclined() = send(PayCraftEventName.OfferDecline, PayCraftStep.Offer)

    /** The buyer cancelled the device-limit choice: an abandon there. */
    fun deviceLimitCancelled() = send(PayCraftEventName.StepAbandon, PayCraftStep.DeviceLimit)

    /**
     * The paywall closed. After a purchase that is success, not an abandon — returns null (also when this showing was
     * already recorded). Otherwise records an abandon at the current step and returns that step (the exit survey asks
     * about it).
     */
    fun abandoned(): PayCraftStep? {
        // Once per showing: the close button sends Dismiss AND the surface then disposes (SurfaceClosed);
        // a swipe or back press sends only the latter. Both paths call this; only the first counts.
        if (!showing) return null
        showing = false
        if (purchased) return null
        send(PayCraftEventName.StepAbandon)
        // Leaving with a checkout started ends the attempt without a purchase — the resume reminder's trigger.
        if (checkoutStarted && attemptId != null) attemptEnded(ResumeNudgeTrigger.CheckoutAbandon)
        return step
    }
}
