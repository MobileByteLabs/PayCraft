package com.mobilebytelabs.paycraft.analytics

/**
 * THE paywall event catalog — every event a PayCraft SDK emits, on every platform (GOAL D9).
 *
 * The same names reach three places: PayCraft's own `paywall_events` table (the exact funnel), the app's
 * analytics through [PayCraftAnalyticsListener] (its GA4 / Firebase), and the website's gtag. So each name is
 * a valid GA4 event name — snake_case, ≤ 40 characters, prefixed `paycraft_` so it never collides with an
 * app's own events — and the server's `events` function refuses any name not listed here.
 * `infra/event-catalog-check.sh` fails the build when an SDK types a `paycraft_*` name that is not in this file.
 */
public enum class PayCraftEventName(public val wire: String) {
    PaywallView("paycraft_paywall_view"),
    PlanSelect("paycraft_plan_select"),

    /** The payment-method sheet opened (the buyer is choosing how to pay). */
    ProviderView("paycraft_provider_view"),
    ProviderSelect("paycraft_provider_select"),
    CheckoutStart("paycraft_checkout_start"),
    CheckoutReturn("paycraft_checkout_return"),
    PurchaseSuccess("paycraft_purchase_success"),
    PurchaseFail("paycraft_purchase_fail"),
    SignInView("paycraft_sign_in_view"),
    SignInComplete("paycraft_sign_in_complete"),
    DeviceLimitView("paycraft_device_limit_view"),

    /** The buyer left at [PayCraftEvent.step] — closed the paywall, backed out of checkout, dismissed sign-in. */
    StepAbandon("paycraft_step_abandon"),
    SurveyView("paycraft_survey_view"),
    SurveyAnswer("paycraft_survey_answer"),
    OfferView("paycraft_offer_view"),
    OfferAccept("paycraft_offer_accept"),
}

/** Where in the buying path an event happened — the funnel's stages and the abandon points. */
public enum class PayCraftStep(public val wire: String) {
    Paywall("paywall"),
    Plan("plan"),
    Provider("provider"),
    Checkout("checkout"),
    SignIn("sign_in"),
    DeviceLimit("device_limit"),
    Survey("survey"),
    Offer("offer"),
}

/**
 * One paywall event. Personal data never goes in an event (GOAL D10): no email, no name, no free text — the
 * buyer is identified server-side by a hashed reference, and a survey's free text is stored first-party only.
 */
public class PayCraftEvent(
    public val name: PayCraftEventName,
    public val step: PayCraftStep,
    /** `android` | `ios` | `web` | `desktop`. */
    public val platform: String,
    /** What opened the paywall: the app's placement (e.g. `home`, `settings`) or `manual` / `if_needed` / `trial_app_open`. */
    public val trigger: String? = null,
    public val sku: String? = null,
    /** The ISO-4217 currency the price was shown in. */
    public val currency: String? = null,
    /** The visitor's ISO-3166 country as the SDK knows it; the server re-stamps it from the request. */
    public val country: String? = null,
    /** The payment provider in play (`razorpay`, `stripe`, `google_play`, `app_store`, …). */
    public val provider: String? = null,
    /** A survey reason code, a purchase-failure code, or a checkout-return result (`success` / `cancel`). */
    public val reason: String? = null,
    public val atMs: Long,
) {
    /** GA4-shaped parameters: only what is set, ≤ 25 keys, values cut to GA4's 100-character limit. */
    public fun params(): Map<String, String> = buildMap {
        put("step", step.wire)
        put("platform", platform)
        trigger?.let { put("trigger", it.take(MAX_VALUE)) }
        sku?.let { put("sku", it.take(MAX_VALUE)) }
        currency?.let { put("currency", it.take(MAX_VALUE)) }
        country?.let { put("country", it.take(MAX_VALUE)) }
        provider?.let { put("provider", it.take(MAX_VALUE)) }
        reason?.let { put("reason", it.take(MAX_VALUE)) }
    }

    private companion object {
        const val MAX_VALUE = 100
    }
}
