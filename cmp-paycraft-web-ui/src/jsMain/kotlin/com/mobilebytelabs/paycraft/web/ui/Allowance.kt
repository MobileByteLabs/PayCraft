package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise

/**
 * This month's use of a metered action [sku] (PayCraft migration 189): [freePerMonth] free uses, [used] so far,
 * [remaining], plus [credits] in the tenant's credit packs; [isPro] users are never metered. Resets at
 * [resetsAt] (ISO-8601, the 1st of next month UTC). For display — metering itself belongs on a server.
 */
@JsExport
class WebAllowance(
    val sku: String,
    val isPro: Boolean,
    val freePerMonth: Int,
    val used: Int,
    val remaining: Int,
    val credits: Int,
    val resetsAt: String,
)

private fun int(v: dynamic): Int = if (jsTypeOf(v) == "number") (v as Number).toInt() else 0

/** "3 of 5 free edits left" for the signed-in buyer of [pc]. Rejects with `sign_in_required` when signed out. */
@JsExport
fun allowance(pc: PayCraftWebApi, sku: String): Promise<WebAllowance> =
    pc.deviceCall("allowance_status", sku, null).then { body ->
        val o: dynamic = JSON.parse(body)
        WebAllowance(
            sku,
            o.is_pro == true,
            int(o.free_per_month),
            int(o.used),
            int(o.remaining),
            int(o.credits),
            (o.resets_at as? String) ?: "",
        )
    }

/** Spend one use of [sku] → `pro` | `allowance` | `credit` | `refused`; the same [idempotencyKey] never charges twice. */
@JsExport
fun spendAllowance(pc: PayCraftWebApi, sku: String, idempotencyKey: String): Promise<String> =
    pc.deviceCall("allowance_spend", sku, idempotencyKey).then { JSON.parse<String>(it) }

/** The signed-in buyer's balance of the consumable [sku] (a credit pack). */
@JsExport
fun creditBalance(pc: PayCraftWebApi, sku: String): Promise<Int> =
    pc.deviceCall("entitlement_balance_get", sku, null).then { int(JSON.parse(it)) }
