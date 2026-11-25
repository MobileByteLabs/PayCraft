package com.mobilebytelabs.paycraft.notify

import com.mobilebytelabs.paycraft.PayCraftInternalApi
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftFailure
import com.mobilebytelabs.paycraft.analytics.PayCraftFailureStage
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.russhwolf.settings.Settings

/**
 * The tenant's resume reminder, from `/config.nudge` (migration 210; paycraft-attempt-observability D10 / D12).
 * Delay and copy are the tenant's; a null title or body on the server means [DEFAULT_TITLE] / [DEFAULT_BODY].
 */
@PayCraftInternalApi
data class NudgeConfig(val enabled: Boolean, val delayMs: Long, val title: String, val body: String) {
    companion object {
        const val DEFAULT_TITLE: String = "Still thinking it over?"
        const val DEFAULT_BODY: String = "Pick up where you left off."
        const val DEFAULT_DELAY_SECONDS: Long = 7_200L

        /** The server's accepted range for `delay_seconds` (one minute to one week). */
        const val MIN_DELAY_SECONDS: Long = 60L
        const val MAX_DELAY_SECONDS: Long = 604_800L

        /** What applies when `/config` has no `nudge` block (a server before migration 210, or no config yet). */
        val Default: NudgeConfig = NudgeConfig(true, DEFAULT_DELAY_SECONDS * 1_000L, DEFAULT_TITLE, DEFAULT_BODY)
    }
}

/** What happened that might deserve a reminder. Only an abandoned checkout and a failed payment do (D10). */
@PayCraftInternalApi
enum class ResumeNudgeTrigger(val wire: String) {
    CheckoutAbandon("checkout_abandon"),
    PaymentFail("payment_fail"),

    /** Picking a plan is not a reason to remind anyone — present so the rule is stated, not implied. */
    PlanSelect("plan_select"),
}

/** Settings key: when the last reminder was scheduled (epoch ms). */
internal const val KEY_LAST_MS = "paycraft.nudge.last_ms"

/** Settings key: the attempt whose reminder is scheduled and not yet cancelled or opened. */
internal const val KEY_PENDING = "paycraft.nudge.pending_attempt"

/**
 * Settings key: the last attempt a decision was made for (scheduled or skipped). A store cancel and the paywall's
 * close both report the same abandon; the second report must neither schedule nor record a second skip.
 */
internal const val KEY_DECIDED = "paycraft.nudge.decided_attempt"

/** At most one reminder per device in this window (D10). */
internal const val SEVEN_DAY_MS = 7L * 86_400_000L

/**
 * Whether a resume reminder may be scheduled now, and its bookkeeping — the same on every platform, so the
 * platform schedulers only post or cancel a notification.
 *
 * A reminder is scheduled only when ALL hold: the trigger is a checkout abandon or a payment failure; the tenant
 * has it on; this attempt has none yet; none was scheduled on this device in the last 7 days; and notification
 * permission is ALREADY granted. The SDK never asks for permission itself (D11) — without it the refusal is
 * recorded as a [PayCraftEventName.NudgeSkipped] event (`sdk / permission / skipped_no_permission`) so the owner
 * can see the reminders their buyers never got.
 */
@PayCraftInternalApi
class ResumeNudgeEligibility(
    private val settings: Settings,
    private val now: () -> Long,
    private val permissionGranted: suspend () -> Boolean,
    private val platform: () -> String = { runCatching { PlatformInfo.platform.lowercase() }.getOrDefault("android") },
    private val emit: (PayCraftEvent) -> Unit,
) {
    suspend fun shouldSchedule(
        trigger: ResumeNudgeTrigger,
        attemptId: String,
        config: NudgeConfig = NudgeConfig.Default,
        sku: String? = null,
    ): Boolean {
        if (trigger != ResumeNudgeTrigger.CheckoutAbandon && trigger != ResumeNudgeTrigger.PaymentFail) return false
        if (!config.enabled) return false
        if (settings.getStringOrNull(KEY_DECIDED) == attemptId) return false
        if (settings.getStringOrNull(KEY_PENDING) == attemptId) return false
        val last = settings.getLongOrNull(KEY_LAST_MS)
        if (last != null && now() - last < SEVEN_DAY_MS) return false
        if (!permissionGranted()) {
            settings.putString(KEY_DECIDED, attemptId)
            emit(event(PayCraftEventName.NudgeSkipped, attemptId, sku, trigger, SKIPPED_NO_PERMISSION))
            return false
        }
        return true
    }

    /** The reminder for [attemptId] was handed to the platform scheduler. */
    fun recordScheduled(
        attemptId: String,
        trigger: ResumeNudgeTrigger = ResumeNudgeTrigger.CheckoutAbandon,
        sku: String? = null,
    ) {
        settings.putLong(KEY_LAST_MS, now())
        settings.putString(KEY_PENDING, attemptId)
        settings.putString(KEY_DECIDED, attemptId)
        emit(event(PayCraftEventName.NudgeScheduled, attemptId, sku, trigger, failure = null))
    }

    /** The attempt whose reminder is still pending, or null. */
    fun pendingAttempt(): String? = settings.getStringOrNull(KEY_PENDING)

    /** Premium arrived: nothing is left to remind about. Returns the attempt whose reminder was pending, if any. */
    fun cancelOnSubscribe(): String? = pendingAttempt().also { settings.remove(KEY_PENDING) }

    /** The buyer tapped the reminder for [attemptId]. */
    fun recordOpened(attemptId: String) {
        if (pendingAttempt() == attemptId) settings.remove(KEY_PENDING)
        emit(event(PayCraftEventName.NudgeOpen, attemptId, sku = null, trigger = null, failure = null))
    }

    private fun event(
        name: PayCraftEventName,
        attemptId: String,
        sku: String?,
        trigger: ResumeNudgeTrigger?,
        failure: PayCraftFailure?,
    ) = PayCraftEvent(
        name = name,
        step = if (name == PayCraftEventName.NudgeOpen) PayCraftStep.Paywall else PayCraftStep.Checkout,
        platform = platform(),
        sku = sku,
        reason = trigger?.wire,
        atMs = now(),
        attemptId = attemptId,
        failure = failure,
    )

    private companion object {
        val SKIPPED_NO_PERMISSION = PayCraftFailure(PayCraftFailureStage.Sdk, "permission", "skipped_no_permission")
    }
}
