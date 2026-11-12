package com.mobilebytelabs.paycraft.winback

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings

// Plain classes, not data classes: the web SDK ships every class it instantiates, and a data class's generated
// toString/equals/hashCode for these six cost ~1 KB gzip of its 150 KB budget (paycraft-paywall-analytics T14).

// Plain classes, not data classes: the web SDK ships every class it instantiates, and the generated
// toString/equals/hashCode of these six cost ~1 KB gzip of its 150 KB budget (paycraft-paywall-analytics T14).

/**
 * The tenant's exit survey, as `/config` serves it (`exit_survey`; dashboard ▸ Paywall ▸ Exit survey).
 * Shown when a buyer closes the paywall or leaves checkout: why didn't you buy? Each [Reason] says what
 * happens when it is chosen — an [Offer] (a win-back discount), a message, or nothing (GOAL D6).
 */
public class ExitSurveyConfig(
    val enabled: Boolean = false,
    val title: String = "",
    val reasons: List<Reason> = emptyList(),
    /** Ask a buyer at most once in this many days (GOAL D7). */
    val capDays: Int = 7,
) {
    public class Reason(
        val code: String,
        val label: String,
        /** `offer` | `message` | `none`. */
        val action: String = "none",
        val message: String? = null,
        /** "Something else": the survey shows a text field (stored first-party only, never sent to analytics). */
        val freeText: Boolean = false,
        /** Present when [action] is `offer` and the tenant attached a live coupon. */
        val offer: Offer? = null,
    )

    public class Offer(
        val percentOff: Int,
        /** `once` | `repeating` | `forever` — how long the discount lasts on the subscription. */
        val duration: String = "once",
        val durationInMonths: Int? = null,
    )
}

/**
 * Whether to show the exit survey now. On the device, not the server: it must answer instantly when the
 * buyer closes the paywall. The time it was last shown is kept in [settings], so the cap survives restarts.
 */
public class ExitSurveyGate(private val settings: Settings, private val now: () -> Long = { currentTimeMillis() }) {
    public fun shouldShow(cfg: ExitSurveyConfig?, isPremium: Boolean): Boolean =
        exitSurveyDue(cfg, isPremium, settings.getLongOrNull(KEY_LAST_SHOWN), now())

    public fun markShown() {
        settings.putLong(KEY_LAST_SHOWN, now())
    }

    private companion object {
        const val KEY_LAST_SHOWN = "paycraft_survey_last_shown"
    }
}

/**
 * The one rule for when the exit survey may be shown (GOAL D7) — the app's [ExitSurveyGate] and the web SDK both
 * ask it, each keeping [lastShownAtMs] in its own storage: the tenant has it on, there is something to ask, the
 * buyer is not premium, and [ExitSurveyConfig.capDays] (at least one) have passed since it was last shown.
 */
public fun exitSurveyDue(cfg: ExitSurveyConfig?, isPremium: Boolean, lastShownAtMs: Long?, nowMs: Long): Boolean {
    if (cfg == null || !cfg.enabled || isPremium || cfg.reasons.isEmpty()) return false
    val last = lastShownAtMs ?: return true
    return nowMs - last >= cfg.capDays.coerceAtLeast(1) * 86_400_000L
}

/**
 * An offer the buyer was given after answering the exit survey (the `winback` function's answer), held while
 * they decide. [stripe] / [razorpay]: the web checkout lanes carry the discount; [googlePlayOfferId] /
 * [appStoreOffer]: the store lanes' own offer for this plan (null = that lane cannot apply it).
 */
public class WinbackOffer(
    val id: String,
    val percentOff: Int,
    val duration: String,
    val durationInMonths: Int?,
    val expiresAtIso: String,
    val sku: String?,
    val stripe: Boolean,
    val razorpay: Boolean,
    val googlePlayOfferId: String?,
    val appStoreOffer: AppStorePromotionalOffer?,
)

/** A server-signed App Store promotional offer (Apple's promotional-offer signature fields). */
public data class AppStorePromotionalOffer(
    val offerId: String,
    val keyIdentifier: String,
    val nonce: String,
    val signature: String,
    val timestamp: Long,
)

/** What the buyer gets for an exit-survey answer (the `winback` function's decision). */
public sealed interface WinbackResult {
    /** A discount for this buyer — show it; [PayCraft.activeWinbackOffer] carries it into checkout once claimed. */
    public class Offer(val offer: WinbackOffer) : WinbackResult

    /** The tenant's message for this reason (e.g. "We also accept UPI on our website"). */
    public class Message(val text: String) : WinbackResult

    /** Nothing more to show — close. */
    public object None : WinbackResult
}
