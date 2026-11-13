package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** The lazy allowance helpers: right RPC, right arguments, and the server's answer read correctly. */
class AllowanceTest {
    private val calls = mutableListOf<List<String?>>()

    private fun pc(answers: Map<String, String>): PayCraftWebApi {
        val o: dynamic = js("({})")
        o.deviceCall = { fn: String, sku: String, key: String? ->
            calls += listOf(fn, sku, key)
            Promise.resolve(answers.getValue(fn))
        }
        return o.unsafeCast<PayCraftWebApi>()
    }

    @Test fun allowance_reads_this_months_use(): Promise<*> = allowance(
        pc(
            mapOf(
                "allowance_status" to
                    """{"sku":"full-edit","is_pro":false,"free_per_month":5,"used":2,"remaining":3,"credits":10,"resets_at":"2026-12-01T00:00:00+00:00"}""",
            ),
        ),
        "full-edit",
    ).then { a ->
        assertEquals(listOf(5, 2, 3, 10), listOf(a.freePerMonth, a.used, a.remaining, a.credits))
        assertFalse(a.isPro)
        assertEquals("2026-12-01T00:00:00+00:00", a.resetsAt)
        assertEquals(listOf("allowance_status", "full-edit", null), calls.single())
    }

    @Test fun spend_passes_the_idempotency_key(): Promise<*> =
        spendAllowance(pc(mapOf("allowance_spend" to "\"credit\"")), "full-edit", "export-42").then {
            assertEquals("credit", it)
            assertEquals(listOf("allowance_spend", "full-edit", "export-42"), calls.single())
        }

    @Test fun balance_reads_a_number(): Promise<*> =
        creditBalance(pc(mapOf("entitlement_balance_get" to "7")), "edits-10").then { assertEquals(7, it) }
}
