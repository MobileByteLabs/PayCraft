package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise

/**
 * What this module uses of the page's `PayCraftWeb` (cmp-paycraft-web) — its exported JavaScript API, described
 * here instead of depended on, so this dist carries none of the SDK (see build.gradle.kts). Every member matches
 * a `@JsExport` member of `PayCraftWeb` / its result classes by name and shape; `infra/web-ui-api-check.sh` fails
 * if a name used here is missing from the built `paycraft-web.d.mts`.
 */
external interface PayCraftWebApi {
    fun email(): String?
    fun maxDevices(): Int
    fun isPremium(): Boolean
    fun config(): Promise<WebConfigView>
    fun devices(): Promise<Array<WebDeviceView>>
    fun paymentOptions(sku: String, currency: String?): Array<WebPaymentOptionView>
    fun checkoutUrlWith(sku: String, currency: String?, provider: String): Promise<String>
    fun checkoutEvent(kind: String, sku: String, currency: String?, provider: String?, reason: String?)
    fun surveyConfig(): Promise<WebExitSurveyView?>
    fun surveyShown(step: String, sku: String?)
    fun answerSurvey(reasonCode: String, step: String, sku: String?, freeText: String?): Promise<WebWinbackView>
    fun claimOffer(offerId: String): Boolean
    fun activeOffer(): WebOfferView?
    fun deviceCall(fn: String, sku: String, idempotencyKey: String?): Promise<String>

    /** Re-reads this buyer's entitlement from PayCraft (checkout's return: has the payment landed yet?). */
    fun premium(): Promise<WebPremiumView>
}

external interface WebPremiumView {
    val isPremium: Boolean
}

external interface WebConfigView {
    val products: Array<WebProductView>
}

external interface WebProductView {
    val sku: String
    val name: String
    val interval: String?
    val amountCents: Int
    val currency: String
    val trialDays: Int?
}

external interface WebDeviceView {
    val maxDevices: Int
}

external interface WebPaymentOptionView {
    val provider: String
    val name: String
    val methods: String
    val methodList: Array<String>
    val cardBrands: Array<String>
    val note: String?
}

external interface WebExitSurveyView {
    val title: String
    val reasons: Array<WebSurveyReasonView>
}

external interface WebSurveyReasonView {
    val code: String
    val label: String
    val freeText: Boolean
}

external interface WebWinbackView {
    val action: String
    val message: String?
    val offer: WebOfferView?
}

external interface WebOfferView {
    val id: String
    val percentOff: Int
    val duration: String
    val durationInMonths: Int?
    val expiresAt: String
}
