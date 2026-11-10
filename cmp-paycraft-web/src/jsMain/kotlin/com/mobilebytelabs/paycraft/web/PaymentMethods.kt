package com.mobilebytelabs.paycraft.web

/**
 * What a buyer can actually pay with through [provider] when charged in [currency] — the rows of the
 * checkout page's payment-method cards.
 *
 * It depends on the currency, not only on the provider: Razorpay offers UPI, netbanking and Indian wallets
 * only for INR (a buyer charged in USD gets international cards and nothing else), so listing "UPI" to a
 * buyer in London would be a promise the provider's page then breaks.
 */
internal class PaymentMethodInfo(
    /** The methods, in the order the provider's page shows them. */
    val methods: List<String>,
    /** Card networks accepted, for the line under the methods; empty when cards are not offered. */
    val cardBrands: List<String>,
    /** One short sentence, e.g. that wallets depend on the device; null when there is nothing to add. */
    val note: String?,
    /** The methods as one phrase — `WebPaymentOption.methods`. */
    val summary: String,
)

internal fun paymentMethods(provider: String, currency: String?): PaymentMethodInfo {
    val cur = currency?.uppercase()
    return when (provider) {
        "razorpay" -> if (cur == null || cur == "INR") {
            PaymentMethodInfo(
                methods = listOf("UPI", "Cards", "Netbanking", "Wallets"),
                cardBrands = listOf("Visa", "Mastercard", "RuPay"),
                note = "Pay with any UPI app — Google Pay, PhonePe, Paytm and more.",
                summary = "UPI, cards, netbanking & wallets",
            )
        } else {
            PaymentMethodInfo(
                methods = listOf("Cards"),
                cardBrands = listOf("Visa", "Mastercard"),
                note = "International cards.",
                summary = "International cards",
            )
        }
        "stripe" -> PaymentMethodInfo(
            methods = listOf("Cards", "Apple Pay", "Google Pay"),
            cardBrands = listOf("Visa", "Mastercard", "American Express"),
            note = "Apple Pay and Google Pay appear on devices that support them.",
            summary = "Cards, Apple Pay & Google Pay",
        )
        else -> PaymentMethodInfo(emptyList(), emptyList(), null, "")
    }
}

internal fun providerDisplayName(provider: String): String = when (provider) {
    "razorpay" -> "Razorpay"
    "stripe" -> "Stripe"
    else -> provider.replaceFirstChar { it.uppercase() }
}
