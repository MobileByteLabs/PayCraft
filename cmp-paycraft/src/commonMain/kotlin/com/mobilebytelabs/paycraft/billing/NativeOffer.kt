package com.mobilebytelabs.paycraft.billing

/**
 * What kind of thing is being bought. Play needs this before it will even look a product up
 * (`ProductType.SUBS` vs `ProductType.INAPP`), and it was hardcoded to SUBS everywhere — so a
 * `Product.Lifetime` rendered on the paywall, was tappable, and could not be bought.
 */
enum class NativeProductType {
    /** Auto-renewing subscription — Play `SUBS`, StoreKit `.autoRenewable`. */
    SUBSCRIPTION,

    /** One-time purchase / lifetime unlock — Play `INAPP`, StoreKit `.nonConsumable`. */
    ONE_TIME,
}

/**
 * One pricing phase of a store offer, flattened to device-free primitives.
 *
 * @param priceAmountMicros price in micro-units; `0` is a FREE phase, i.e. a trial.
 * @param billingPeriodIso ISO-8601 duration of this phase (`P1W`, `P1M`, `P1Y`).
 * @param billingCycleCount how many times this phase repeats; `0` means "for the rest of the term".
 */
data class NativePricingPhase(
    val priceAmountMicros: Long,
    val formattedPrice: String,
    val currencyCode: String,
    val billingPeriodIso: String,
    val billingCycleCount: Int = 0,
) {
    /** A zero-price phase is a free trial. */
    val isFree: Boolean get() = priceAmountMicros == 0L
}

/**
 * One purchasable offer on a store product — a base plan, a free trial, an intro price, or a
 * developer-determined offer.
 *
 * @param offerToken opaque store token identifying this offer at purchase time (Play `offerToken`).
 * @param pricingPhases in the order the shopper will be charged: any free/intro phases first, then
 *   the recurring base phase.
 */
data class NativeOffer(
    val offerToken: String,
    val offerId: String? = null,
    val pricingPhases: List<NativePricingPhase>,
) {
    /** Total free days across the leading free phases — what "7-day free trial" actually means. */
    val freeTrialDays: Int
        get() = pricingPhases.takeWhile { it.isFree }.sumOf { phase ->
            isoPeriodToDays(phase.billingPeriodIso) * phase.billingCycleCount.coerceAtLeast(1)
        }

    /** The first phase the shopper is actually charged for — the price to advertise. */
    val recurringPhase: NativePricingPhase?
        get() = pricingPhases.firstOrNull { !it.isFree } ?: pricingPhases.lastOrNull()
}

/**
 * Pick the offer to purchase from everything the store says this shopper is eligible for.
 *
 * Play returns EVERY eligible offer — base plan, free trial, intro price, developer offers — in an
 * order that carries no meaning. The SDK used to take `subscriptionOfferDetails.firstOrNull()`, so
 * which offer a buyer received was effectively arbitrary: a free trial configured in Play Console
 * applied or didn't depending on the order Play happened to return that day, and the paywall
 * advertised whichever offer's first phase came back first.
 *
 * Ranking, best-for-the-shopper first:
 *  1. longest free trial — a trial is the strongest conversion lever and the thing most likely to
 *     have been configured deliberately;
 *  2. then lowest first-charged price (an intro offer beats the base plan);
 *  3. then a stable tie-break on offer id, so the same shopper keeps seeing the same offer rather
 *     than having it flicker between launches.
 *
 * Returns null only when there are no offers at all.
 */
fun selectBestOffer(offers: List<NativeOffer>): NativeOffer? = offers
    .minWithOrNull(
        compareByDescending<NativeOffer> { it.freeTrialDays }
            .thenBy { it.recurringPhase?.priceAmountMicros ?: Long.MAX_VALUE }
            .thenBy { it.offerId.orEmpty() },
    )

/**
 * ISO-8601 duration → whole days, for the subset Play and StoreKit emit for billing periods
 * (`P3D`, `P1W`, `P1M`, `P6M`, `P1Y`). Months are 30 days and years 365 — these drive display copy
 * ("7-day free trial") and trial ranking, never billing arithmetic, so calendar precision would be
 * false precision here.
 *
 * Returns 0 for anything unparseable, which sorts an unknown period last rather than crashing.
 */
internal fun isoPeriodToDays(iso: String): Int {
    if (!iso.startsWith("P")) return 0
    val body = iso.removePrefix("P").substringBefore("T") // time components are not billing periods
    var days = 0
    var number = StringBuilder()
    for (ch in body) {
        if (ch.isDigit()) {
            number.append(ch)
            continue
        }
        val value = number.toString().toIntOrNull() ?: return 0
        number = StringBuilder()
        days += when (ch) {
            'Y' -> value * 365
            'M' -> value * 30
            'W' -> value * 7
            'D' -> value
            else -> return 0
        }
    }
    return days
}
