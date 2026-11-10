package com.mobilebytelabs.paycraft.winback

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The tenant's exit survey, as `/config` serves it (`exit_survey`; dashboard ▸ Paywall ▸ Exit survey).
 * Shown when a buyer closes the paywall or leaves checkout: why didn't you buy? Each [Reason] says what
 * happens when it is chosen — an [Offer] (a win-back discount), a message, or nothing (GOAL D6).
 */
@Serializable
public data class ExitSurveyConfig(
    val enabled: Boolean = false,
    val title: String = "",
    val reasons: List<Reason> = emptyList(),
    /** Ask a buyer at most once in this many days (GOAL D7). */
    @SerialName("cap_days") val capDays: Int = 7,
) {
    @Serializable
    public data class Reason(
        val code: String,
        val label: String,
        /** `offer` | `message` | `none`. */
        val action: String = "none",
        val message: String? = null,
        /** "Something else": the survey shows a text field (stored first-party only, never sent to analytics). */
        @SerialName("free_text") val freeText: Boolean = false,
        /** Present when [action] is `offer` and the tenant attached a live coupon. */
        val offer: Offer? = null,
    )

    @Serializable
    public data class Offer(
        @SerialName("percent_off") val percentOff: Int,
        /** `once` | `repeating` | `forever` — how long the discount lasts on the subscription. */
        val duration: String = "once",
        @SerialName("duration_in_months") val durationInMonths: Int? = null,
    )
}

/**
 * Whether to show the exit survey now. On the device, not the server: it must answer instantly when the
 * buyer closes the paywall. The time it was last shown is kept in [settings], so the cap survives restarts.
 */
public class ExitSurveyGate(
    private val settings: Settings,
    private val now: () -> Long = { currentTimeMillis() },
) {
    public fun shouldShow(cfg: ExitSurveyConfig?, isPremium: Boolean): Boolean {
        if (cfg == null || !cfg.enabled || isPremium || cfg.reasons.isEmpty()) return false
        val last = settings.getLongOrNull(KEY_LAST_SHOWN) ?: return true
        return now() - last >= cfg.capDays.coerceAtLeast(1) * DAY_MS
    }

    public fun markShown() {
        settings.putLong(KEY_LAST_SHOWN, now())
    }

    private companion object {
        const val KEY_LAST_SHOWN = "paycraft_survey_last_shown"
        const val DAY_MS = 86_400_000L
    }
}
