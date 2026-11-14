package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.substituteVariables
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A separator must not outlive the variable it separated. reels-downloader 2026-11-14: Play gave a returning
 * shopper no trial on monthly, the plan's sub-line template was "Billed monthly · {{ product.trial_label }}",
 * and the card read "Billed monthly ·".
 */
class PaywallVariableSeparatorTest {

    private val noTrial = PackagePrice(display = "₹299")
    private val trial = PackagePrice(display = "₹1499", trialDays = 14)

    @Test
    fun a_trailing_separator_goes_with_its_empty_variable() {
        assertEquals("Billed monthly", substituteVariables("Billed monthly · {{ product.trial_label }}", noTrial))
    }

    @Test
    fun a_filled_variable_keeps_its_separator() {
        assertEquals(
            "Billed every 6 months · 14-day free trial",
            substituteVariables("Billed every 6 months · {{ product.trial_label }}", trial),
        )
    }

    @Test
    fun leading_and_doubled_separators_collapse() {
        assertEquals("Best value", substituteVariables("{{ product.trial_label }} · Best value", noTrial))
        assertEquals(
            "₹299 · Best value",
            substituteVariables("{{ product.price }} · {{ product.trial_label }} · Best value", noTrial),
        )
    }

    @Test
    fun copy_without_an_empty_variable_is_untouched() {
        assertEquals("₹299 ·", substituteVariables("{{ product.price }} ·", noTrial))
    }
}
