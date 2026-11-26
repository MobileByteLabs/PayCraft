package com.mobilebytelabs.paycraft.notify

import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.code
import com.mobilebytelabs.paycraft.analytics.errorClass
import com.mobilebytelabs.paycraft.analytics.stage
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The resume reminder's rules (paycraft-attempt-observability D10 / D11, AC-12): only after a checkout abandon or a
 * payment failure, only with notification permission ALREADY granted (otherwise a recorded `skipped_no_permission`),
 * at most once per attempt and once a week per device, gone once the buyer subscribes — with delay and copy taken
 * from the tenant's `/config`, never an SDK constant.
 */
class ResumeNudgeEligibilityTest {
    private val settings = MapSettings()
    private var nowMs = 100_000L
    private val events = mutableListOf<PayCraftEvent>()

    private fun elig(permission: Boolean) = ResumeNudgeEligibility(
        settings,
        now = { nowMs },
        permissionGranted = { permission },
        platform = { "android" },
    ) { events += it }

    @Test fun only_abandon_or_fail_schedules() = runTest {
        assertTrue(elig(true).shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "att-1"))
        assertTrue(elig(true).shouldSchedule(ResumeNudgeTrigger.PaymentFail, "att-2"))
        assertFalse(elig(true).shouldSchedule(ResumeNudgeTrigger.PlanSelect, "att-3"))
        assertTrue(events.isEmpty(), "deciding records nothing — only a refusal for permission or a schedule does")
    }

    @Test fun no_permission_emits_skipped_event_and_refuses() = runTest {
        assertFalse(elig(false).shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "att-1", sku = "pro-monthly"))
        val skipped = events.single()
        assertEquals(PayCraftEventName.NudgeSkipped, skipped.name)
        assertEquals("skipped_no_permission", skipped.code)
        assertEquals("permission", skipped.errorClass)
        assertEquals("sdk", skipped.stage)
        assertEquals("att-1", skipped.attemptId)
        assertEquals("checkout_abandon", skipped.reason)
        assertNull(settings.getStringOrNull(KEY_PENDING), "nothing scheduled")
    }

    @Test fun seven_day_cap_blocks_second_within_window() = runTest {
        val e = elig(true)
        assertTrue(e.shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "a"))
        e.recordScheduled("a")
        nowMs += 6L * 24 * 3600 * 1000
        assertFalse(e.shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "b"))
        nowMs += 2L * 24 * 3600 * 1000
        assertTrue(e.shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "c"))
    }

    @Test fun the_same_abandon_reported_twice_records_one_skip() = runTest {
        // A store cancel and then the paywall's close both report attempt "a".
        assertFalse(elig(false).shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "a"))
        assertFalse(elig(false).shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "a"))
        assertEquals(1, events.count { it.name == PayCraftEventName.NudgeSkipped })
    }

    @Test fun one_reminder_per_attempt() = runTest {
        val e = elig(true)
        e.recordScheduled("a")
        nowMs += 8L * 24 * 3600 * 1000 // even past the weekly cap, the same attempt is not reminded twice
        assertFalse(e.shouldSchedule(ResumeNudgeTrigger.PaymentFail, "a"))
    }

    @Test fun scheduling_is_recorded_on_the_attempt_timeline() {
        elig(true).recordScheduled("a", ResumeNudgeTrigger.PaymentFail, sku = "pro-annual")
        val scheduled = events.single()
        assertEquals(PayCraftEventName.NudgeScheduled, scheduled.name)
        assertEquals("a", scheduled.attemptId)
        assertEquals("payment_fail", scheduled.reason)
        assertEquals("pro-annual", scheduled.sku)
        assertNull(scheduled.failure, "scheduling is not a failure")
    }

    @Test fun subscribe_cancels_pending() {
        val e = elig(true)
        e.recordScheduled("a")
        assertEquals("a", e.cancelOnSubscribe())
        assertTrue(settings.getStringOrNull(KEY_PENDING) == null)
        assertNull(e.cancelOnSubscribe(), "nothing left to cancel")
    }

    @Test fun opening_the_reminder_is_recorded_and_clears_it() {
        val e = elig(true)
        e.recordScheduled("a")
        e.recordOpened("a")
        assertEquals(PayCraftEventName.NudgeOpen, events.last().name)
        assertEquals("a", events.last().attemptId)
        assertNull(e.pendingAttempt())
    }

    @Test fun a_tenant_that_turned_the_reminder_off_gets_none() = runTest {
        val off = PayCraftContract.decodeNudgeConfig("""{"nudge":{"enabled":false,"delay_seconds":60}}""")
        assertFalse(elig(true).shouldSchedule(ResumeNudgeTrigger.CheckoutAbandon, "a", off))
    }

    @Test fun delay_and_copy_come_from_config() {
        val cfg = PayCraftContract.decodeNudgeConfig(
            """{"products":[],"nudge":{"enabled":true,"delay_seconds":60,"title":"Your Pro trial is waiting","body":"Tap to finish."}}""",
        )
        assertEquals(60_000L, cfg.delayMs)
        assertEquals("Your Pro trial is waiting", cfg.title)
        assertEquals("Tap to finish.", cfg.body)
    }

    @Test fun null_copy_is_the_sdk_default_and_an_absent_block_is_the_two_hour_default() {
        val nullCopy = PayCraftContract.decodeNudgeConfig(
            """{"nudge":{"enabled":true,"delay_seconds":3600,"title":null,"body":null}}""",
        )
        assertEquals(3_600_000L, nullCopy.delayMs)
        assertEquals(NudgeConfig.DEFAULT_TITLE, nullCopy.title)
        assertEquals(NudgeConfig.DEFAULT_BODY, nullCopy.body)
        assertEquals(NudgeConfig.Default, PayCraftContract.decodeNudgeConfig("""{"products":[]}"""))
        assertEquals(7_200_000L, NudgeConfig.Default.delayMs)
        assertEquals(NudgeConfig.Default, PayCraftContract.decodeNudgeConfig("not json"))
    }

    @Test fun a_delay_outside_the_servers_range_is_clamped_into_it() {
        assertEquals(60_000L, PayCraftContract.decodeNudgeConfig("""{"nudge":{"delay_seconds":5}}""").delayMs)
        assertEquals(
            604_800_000L,
            PayCraftContract.decodeNudgeConfig("""{"nudge":{"delay_seconds":99999999}}""").delayMs,
        )
    }

    @Test fun a_reminder_identifier_leads_back_to_its_attempt_only_when_it_is_paycrafts() {
        assertEquals("1764-ab", ResumeNudgeIds.attemptIdOf(ResumeNudgeIds.identifier("1764-ab")))
        assertNull(ResumeNudgeIds.attemptIdOf("host.app.daily_reminder"))
        assertNull(ResumeNudgeIds.attemptIdOf(ResumeNudgeIds.PREFIX))
    }
}
