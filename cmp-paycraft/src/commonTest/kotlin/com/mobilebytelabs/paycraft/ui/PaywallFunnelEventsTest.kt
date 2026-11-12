package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Every step of the mobile paywall reports where the buyer is and where they left (GOAL AC-2): the
 * paywall, the plan, the payment-method sheet, checkout, sign-in and the device limit. Each event carries
 * the step, what opened the paywall, the plan, its currency, the country and the provider in play — the
 * dimensions the dashboard funnel and the exit survey are built on.
 */
class PaywallFunnelEventsTest {

    private val events = mutableListOf<PayCraftEvent>()
    private val monthly =
        BillingPlan(
            id = "pro-monthly",
            name = "Pro Monthly",
            price = "₹299",
            interval = "month",
            rank = 1,
            currency = "INR",
        )

    private fun vm(billing: FakeBillingManager = FakeBillingManager()) = PayCraftPaywallViewModel(billing).also {
        it.funnel =
            PaywallFunnelTracker(emit = { e -> events += e }, now = { 7L })
    }

    private fun names() = events.map { it.name }

    @BeforeTest fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        PayCraft.paywallPlacement = "home"
    }

    @AfterTest fun tearDown() {
        Dispatchers.resetMain()
        PayCraft.paywallPlacement = null
    }

    @Test fun closing_the_paywall_reports_a_view_then_an_abandon_at_the_paywall() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.Dismiss)
        assertEquals(listOf(PayCraftEventName.PaywallView, PayCraftEventName.StepAbandon), names())
        assertEquals(PayCraftStep.Paywall, events[1].step)
        assertEquals("home", events[0].trigger)
        assertEquals("US", events[0].country)
        assertEquals(7L, events[0].atMs)
    }

    @Test fun a_swipe_close_is_an_abandon_and_the_close_button_is_counted_once() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.SurfaceClosed) // swipe / back: no Dismiss action
        v.onShown()
        v.dispatch(PayCraftPaywallAction.Dismiss)
        v.dispatch(PayCraftPaywallAction.SurfaceClosed) // the close button also disposes the surface
        assertEquals(2, events.count { it.name == PayCraftEventName.StepAbandon })
    }

    @Test fun leaving_after_picking_a_plan_abandons_at_the_plan_with_its_sku_and_currency() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.SelectPlan(monthly))
        v.dispatch(PayCraftPaywallAction.Dismiss)
        assertEquals(PayCraftEventName.PlanSelect, events[1].name)
        val abandon = events.last()
        assertEquals(PayCraftEventName.StepAbandon, abandon.name)
        assertEquals(PayCraftStep.Plan, abandon.step)
        assertEquals("pro-monthly", abandon.sku)
        assertEquals("INR", abandon.currency)
    }

    @Test fun the_payment_method_sheet_reports_its_view_and_its_dismissal() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.ShowProviderSheet(monthly))
        v.dispatch(PayCraftPaywallAction.DismissProviderSheet)
        assertEquals(PayCraftEventName.ProviderView, events[1].name)
        assertEquals(PayCraftStep.Provider, events[1].step)
        assertEquals(PayCraftEventName.StepAbandon, events[2].name)
        assertEquals(PayCraftStep.Provider, events[2].step)
    }

    @Test fun choosing_a_provider_reports_the_choice_and_the_checkout_start() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.CheckoutWithProvider(monthly, ProviderDto(provider = "razorpay")))
        val start = events.first { it.name == PayCraftEventName.CheckoutStart }
        assertEquals(PayCraftStep.Checkout, start.step)
        assertEquals("razorpay", start.provider)
        assertEquals(PayCraftEventName.ProviderSelect, events[events.indexOf(start) - 1].name)
    }

    @Test fun a_checkout_that_cannot_start_is_reported_as_a_failure_with_its_reason() {
        val t = PaywallFunnelTracker(emit = { e -> events += e }, now = { 7L })
        t.shown()
        t.checkoutStarted(monthly, "razorpay")
        t.purchaseFailed("checkout_rejected")
        assertEquals(PayCraftEventName.PurchaseFail, events.last().name)
        assertEquals("checkout_rejected", events.last().reason)
        assertEquals(PayCraftStep.Checkout, events.last().step)
    }

    @Test fun sign_in_reports_its_view_and_completion() {
        val billing = FakeBillingManager()
        val v = vm(billing)
        v.onShown()
        v.dispatch(PayCraftPaywallAction.LoginWithOAuth(OAuthProvider.GOOGLE, idToken = "id-token"))
        billing.emitEmail("buyer@example.com")
        assertEquals(PayCraftEventName.SignInView, events[1].name)
        assertEquals(PayCraftStep.SignIn, events[1].step)
        assertEquals(PayCraftEventName.SignInComplete, events[2].name)
    }

    @Test fun the_device_limit_reports_its_view_and_a_cancel_abandons_there() {
        val billing = FakeBillingManager()
        val v = vm(billing)
        v.onShown()
        billing.emitState(BillingState.DeviceConflict("a@b.c", "tok", "Pixel 7", null, "help@x.com"))
        v.dispatch(PayCraftPaywallAction.CancelDeviceTransfer)
        assertEquals(PayCraftEventName.DeviceLimitView, events[1].name)
        assertEquals(PayCraftStep.DeviceLimit, events[2].step)
        assertEquals(PayCraftEventName.StepAbandon, events[2].name)
    }

    @Test fun becoming_premium_after_checkout_reports_a_purchase_and_closing_is_not_an_abandon() {
        val billing = FakeBillingManager()
        val v = vm(billing)
        v.onShown()
        v.dispatch(PayCraftPaywallAction.CheckoutWithProvider(monthly, ProviderDto(provider = "stripe")))
        billing.emitState(BillingState.Premium(SubscriptionStatus(isPremium = true, plan = "pro-monthly")))
        v.dispatch(PayCraftPaywallAction.Dismiss)
        assertEquals(PayCraftEventName.PurchaseSuccess, events.last().name)
        assertEquals("pro-monthly", events.last().sku)
    }

    // ── Found on a device (Reels Downloader, 2026-11-11): what the events said vs. what happened ──

    /** A config-built plan's id is the product UUID; the funnel, the dashboard and the website all key on the SKU. */
    private val quarterly = BillingPlan(
        id = "35515f32-a5db-4b2e-b159-72e0ce4becda",
        sku = "pro-quarterly",
        name = "Pro Quarterly",
        price = "₹799",
        interval = "quarter",
        rank = 2,
        currency = "INR",
    )

    @Test fun events_carry_the_plan_sku_not_its_product_id() {
        val v = vm()
        v.onShown()
        v.dispatch(PayCraftPaywallAction.SelectPlan(quarterly))
        assertEquals("pro-quarterly", events.last().sku)
    }

    @Test fun the_designs_default_plan_is_selected_but_is_not_counted_as_the_buyers_pick() {
        val v = vm()
        v.onShown()
        v.applyDefaultPlan(quarterly)
        assertEquals(quarterly, v.state.value.selectedPlan)
        assertEquals(listOf(PayCraftEventName.PaywallView), names(), "no paycraft_plan_select for a pre-selection")
        v.dispatch(PayCraftPaywallAction.SelectPlan(quarterly))
        assertEquals(PayCraftEventName.PlanSelect, events.last().name, "a real tap still counts")
    }

    @Test fun a_placement_labels_one_paywall_and_does_not_leak_into_the_next() {
        val v = vm()
        v.onShown() // placement "home" from setUp
        PayCraft.paywallPlacement = "browser" // set mid-funnel: must not relabel this paywall
        v.dispatch(PayCraftPaywallAction.Dismiss)
        assertEquals(listOf("home", "home"), events.map { it.trigger })
        events.clear()
        PayCraft.paywallPlacement = null
        v.onShown()
        assertEquals("direct", events.single().trigger, "the earlier placement was consumed")
    }
}
