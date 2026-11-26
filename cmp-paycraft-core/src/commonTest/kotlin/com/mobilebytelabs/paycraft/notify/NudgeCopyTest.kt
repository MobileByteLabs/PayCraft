package com.mobilebytelabs.paycraft.notify

import com.mobilebytelabs.paycraft.PayCraftInternalApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * The resume reminder speaks about the subscription the buyer picked (owner copy, 2026-11-25): the default reads
 * "Your Premium is waiting 👑" / "Your {plan} plan is saved — tap to finish upgrading in seconds.", with {plan}
 * filled from the picked plan's name. A tenant's own copy may use {plan} too.
 */
@OptIn(PayCraftInternalApi::class)
class NudgeCopyTest {

    @Test
    fun default_copy_is_about_the_subscription() {
        assertEquals("Your Premium is waiting 👑", NudgeConfig.DEFAULT_TITLE)
        assertEquals("Your {plan} plan is saved — tap to finish upgrading in seconds.", NudgeConfig.DEFAULT_BODY)
    }

    @Test
    fun the_picked_plan_is_named_in_the_body() {
        val c = NudgeConfig.Default.personalized("Pro Monthly")
        assertEquals("Your Pro Monthly plan is saved — tap to finish upgrading in seconds.", c.body)
        assertEquals("Your Premium is waiting 👑", c.title)
    }

    @Test
    fun an_unknown_plan_reads_naturally() {
        val c = NudgeConfig.Default.personalized(null)
        assertEquals("Your Premium plan is saved — tap to finish upgrading in seconds.", c.body)
        assertFalse(c.body.contains("{plan}"))
        assertFalse(NudgeConfig.Default.personalized("  ").body.contains("{plan}"))
    }

    @Test
    fun a_tenant_template_may_use_the_placeholder_in_title_and_body() {
        val tenant = NudgeConfig(true, 60_000L, "{plan} is one tap away", "Finish your {plan} upgrade")
        val c = tenant.personalized("Annual")
        assertEquals("Annual is one tap away", c.title)
        assertEquals("Finish your Annual upgrade", c.body)
        assertEquals(60_000L, c.delayMs)
    }
}
