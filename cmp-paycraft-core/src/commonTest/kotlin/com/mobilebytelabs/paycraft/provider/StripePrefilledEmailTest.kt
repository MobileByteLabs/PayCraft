package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The buyer's email in a hosted-checkout link must be URL-encoded.
 *
 * Regression for the defect this exists to fix: the providers appended the raw address
 * (`"$url?prefilled_email=$email"`). In a query string `+` decodes as a space, so a buyer signed in
 * as `a+b@x.com` reached Stripe as `a b@x.com` — the purchase was then recorded against an email
 * no account has, and premium never unlocked. The same concatenation existed for Paddle,
 * LemonSqueezy and Flutterwave. Links that already carry a query string also got a second `?`.
 */
class StripePrefilledEmailTest {
    private val plan = BillingPlan(id = "pro_monthly", name = "Pro", price = "$5", interval = "month", rank = 1)
    private val links = mapOf("pro_monthly" to "https://buy.stripe.com/test_abc")

    @Test
    fun stripeCheckoutEncodesPlusAndAt() {
        val url = StripeProvider(testPaymentLinks = links, isTestMode = true).getCheckoutUrl(plan, "a+b@x.com")
        assertEquals("https://buy.stripe.com/test_abc?prefilled_email=a%2Bb%40x.com", url)
    }

    @Test
    fun stripePortalEncodesEmail() {
        val url = StripeProvider(
            testPortalUrl = "https://billing.stripe.com/p/login/x",
            isTestMode = true,
        ).getManageUrl("a+b@x.com")
        assertEquals("https://billing.stripe.com/p/login/x?prefilled_email=a%2Bb%40x.com", url)
    }

    @Test
    fun noEmailLeavesTheLinkUntouched() {
        assertEquals(
            "https://buy.stripe.com/test_abc",
            StripeProvider(testPaymentLinks = links, isTestMode = true).getCheckoutUrl(plan, null),
        )
    }

    @Test
    fun linkWithAQueryStringGetsAnAmpersand() {
        val withQuery = mapOf("pro_monthly" to "https://buy.stripe.com/test_abc?locale=en")
        val url = StripeProvider(testPaymentLinks = withQuery, isTestMode = true).getCheckoutUrl(plan, "a+b@x.com")
        assertEquals("https://buy.stripe.com/test_abc?locale=en&prefilled_email=a%2Bb%40x.com", url)
    }

    @Test
    fun otherHostedCheckoutsEncodeToo() {
        assertEquals(
            "https://pay.paddle.com/x?customer_email=a%2Bb%40x.com",
            PaddleProvider(
                testPaymentLinks = mapOf("pro_monthly" to "https://pay.paddle.com/x"),
                isTestMode = true,
            ).getCheckoutUrl(plan, "a+b@x.com"),
        )
        assertEquals(
            "https://store.lemonsqueezy.com/x?checkout%5Bemail%5D=a%2Bb%40x.com",
            LemonSqueezyProvider(
                mapOf("pro_monthly" to "https://store.lemonsqueezy.com/x"),
            ).getCheckoutUrl(plan, "a+b@x.com"),
        )
        assertEquals(
            "https://flutterwave.com/pay/x?customer%5Bemail%5D=a%2Bb%40x.com",
            FlutterwaveProvider(
                mapOf("pro_monthly" to "https://flutterwave.com/pay/x"),
            ).getCheckoutUrl(plan, "a+b@x.com"),
        )
    }
}
