package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.platform.currentTimeMillis

/**
 * Turns what happens in the paywall into catalog events (paycraft-paywall-analytics, GOAL AC-2).
 *
 * It remembers the step the buyer is on — paywall → plan → payment method → checkout, with sign-in and the
 * device limit along the way — so when they leave, [abandoned] reports WHERE they left, with the plan,
 * currency, provider and what opened the paywall. The ViewModel calls it at each transition; events go to
 * [PayCraft.analytics] (the app's listener + PayCraft's funnel) unless a test hands in [emit].
 */
internal class PaywallFunnelTracker(
    private val emit: (PayCraftEvent) -> Unit = { PayCraft.analytics.emit(it) },
    private val now: () -> Long = { currentTimeMillis() },
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
                }
                PaywallPresentation.Hidden -> "direct"
            }
    }

    private fun send(name: PayCraftEventName, step: PayCraftStep = this.step, reason: String? = null) {
        emit(
            PayCraftEvent(
                name = name, step = step,
                platform = runCatching { PlatformInfo.platform.lowercase() }.getOrDefault("android"),
                trigger = trigger, sku = sku, currency = currency,
                country = runCatching { PayCraft.activeCountry }.getOrNull(),
                provider = provider, reason = reason, atMs = now(),
            ),
        )
    }

    /** The paywall appeared (each time it is shown — the ViewModel outlives the sheet). */
    fun shown() {
        step = PayCraftStep.Paywall
        trigger = resolveTrigger()
        provider = null
        checkoutStarted = false
        purchased = false
        showing = true
        send(PayCraftEventName.PaywallView)
    }

    fun planSelected(plan: BillingPlan) {
        sku = plan.sku
        currency = plan.currency
        step = PayCraftStep.Plan
        send(PayCraftEventName.PlanSelect)
    }

    fun providerSheetShown(plan: BillingPlan) {
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
        sku = plan.sku
        currency = plan.currency
        provider = providerId
        step = PayCraftStep.Provider
        send(PayCraftEventName.ProviderSelect)
    }

    fun checkoutStarted(plan: BillingPlan, providerId: String?) {
        sku = plan.sku
        currency = plan.currency
        if (providerId != null) provider = providerId
        step = PayCraftStep.Checkout
        checkoutStarted = true
        send(PayCraftEventName.CheckoutStart)
    }

    fun purchaseFailed(reason: String) = send(PayCraftEventName.PurchaseFail, reason = reason.take(100))

    /** Premium arrived. Counted once, and only for a checkout started from this paywall. */
    fun purchaseSucceeded(planId: String?) {
        if (purchased || !checkoutStarted) return
        purchased = true
        if (planId != null) sku = planId
        send(PayCraftEventName.PurchaseSuccess)
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
        return step
    }
}
