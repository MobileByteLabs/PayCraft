package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.contract.PayCraftContract

/**
 * Adds the buyer's email to a hosted-checkout or billing-portal link as a query parameter, encoded.
 *
 * Every hosted checkout (Stripe `prefilled_email`, Paddle `customer_email`, LemonSqueezy
 * `checkout[email]`, Flutterwave `customer[email]`) matches the purchase back to the buyer by this
 * address, so it must arrive exactly as typed: a raw `+` decodes as a space and the purchase lands
 * on an email no account has. Uses `&` when the link already carries a query string.
 */
internal fun withEmailParam(url: String, param: String, email: String?): String =
    PayCraftContract.withEmailParam(url, param, email)
