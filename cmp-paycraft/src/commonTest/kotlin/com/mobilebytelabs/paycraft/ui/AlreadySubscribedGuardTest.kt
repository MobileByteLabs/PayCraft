package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A buyer who already pays for this app must be sent to restore, not charged again. Motivated by a
 * live Reels customer who bought the same plan twice a week apart with the same email.
 */
class AlreadySubscribedGuardTest {

    private val monthly =
        BillingPlan(
            id = "pro-monthly",
            name = "Pro Monthly",
            price = "$4",
            interval = "month",
            rank = 1,
            currency = "USD",
        )

    @BeforeTest fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest fun tearDown() = Dispatchers.resetMain()

    private fun subscribeAs(email: String, billing: FakeBillingManager): PayCraftPaywallViewModel =
        PayCraftPaywallViewModel(billing).apply {
            dispatch(PayCraftPaywallAction.SelectPlan(monthly))
            dispatch(PayCraftPaywallAction.UpdateEmail(email))
            dispatch(PayCraftPaywallAction.Subscribe)
        }

    @Test fun an_email_that_already_pays_opens_restore_instead_of_checkout() {
        val billing = FakeBillingManager().apply { activeSubscriptionEmails = setOf("paid@buyer.test") }
        val s = subscribeAs("Paid@Buyer.test", billing).state.value
        assertTrue(s.isRestoreSheetVisible)
        assertEquals("Paid@Buyer.test", s.alreadySubscribedEmail)
        assertFalse(s.isSubmitting)
        assertNull(s.errorMessage, "checkout must not have been attempted")
    }

    @Test fun a_new_buyer_goes_on_to_checkout() {
        val s = subscribeAs("new@buyer.test", FakeBillingManager()).state.value
        assertFalse(s.isRestoreSheetVisible)
        assertNull(s.alreadySubscribedEmail)
    }

    @Test fun closing_restore_clears_the_already_subscribed_notice() {
        val billing = FakeBillingManager().apply { activeSubscriptionEmails = setOf("paid@buyer.test") }
        val vm = subscribeAs("paid@buyer.test", billing)
        vm.dispatch(PayCraftPaywallAction.CloseRestoreSheet)
        assertFalse(vm.state.value.isRestoreSheetVisible)
        assertNull(vm.state.value.alreadySubscribedEmail)
    }
}
