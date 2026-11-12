// HTML/CSS carried in string templates (the exit survey dialog); only the line-length rule is relaxed, as in CheckoutPage.kt.
@file:Suppress("ktlint:standard:max-line-length")

package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise

/**
 * The tenant's exit survey (paycraft-paywall-analytics GOAL D6) as a dialog — centred on a wide screen, a bottom
 * sheet on a phone — for a buyer leaving [sku]'s checkout at [step] without paying. Shown only when [pc]'s
 * `surveyConfig()` says it is due (tenant on, not premium, outside its cap). An answer that earns a discount shows
 * the offer; "Claim" applies it to the next checkout (`pc.claimOffer`). Resolves with what happened:
 * `none` (not shown), `dismissed` (skipped / closed / no thanks), `answered`, or `claimed` — a page that is not
 * the checkout sends the buyer there on `claimed`. Never rejects.
 */
@JsExport
fun showExitSurvey(pc: dynamic, step: String, sku: String?): Promise<String> {
    val api = pc.unsafeCast<PayCraftWebApi>()
    return api.surveyConfig().then({ it }, { null }).then { cfg ->
        if (cfg == null || cfg.reasons.isEmpty()) Promise.resolve("none") else openSurvey(api, cfg, step, sku)
    }.unsafeCast<Promise<String>>()
}

private const val SURVEY_STYLE_ID = "paycraft-survey-style"

private fun openSurvey(pc: PayCraftWebApi, cfg: WebExitSurveyView, step: String, sku: String?): Promise<String> =
    Promise {
            resolve,
            _,
        ->
        val doc: dynamic = js("document")
        addStyleOnce(doc, SURVEY_STYLE_ID, SURVEY_CSS)
        val dialog = doc.createElement("dialog")
        dialog.className = "pcx-s"
        dialog.setAttribute("aria-labelledby", "pcx-s-h")
        dialog.innerHTML = surveyHtml(cfg)
        doc.body.appendChild(dialog)
        var outcome = "dismissed"
        var timer: dynamic = null
        dialog.addEventListener("close", { _: dynamic ->
            if (timer != null) js("clearInterval")(timer)
            dialog.remove()
            resolve(outcome)
        })
        val close = { result: String ->
            outcome = result
            dialog.close()
        }
        fun showOffer(o: WebOfferView) {
            pc.config().then({ c -> c.products.firstOrNull { it.sku == sku } }, { null }).then { product ->
                val render = { dialog.innerHTML = offerHtml(o, product, offerTimeLeft(o.expiresAt, nowMs())) }
                render()
                timer = js("setInterval")(render, 30_000)
            }
        }
        dialog.addEventListener("change", { _: dynamic ->
            val send = dialog.querySelector("[data-pcx-s-send]")
            if (send != null) send.disabled = dialog.querySelector("input[name=pcx-s-r]:checked") == null
        })
        dialog.addEventListener("click", { e: dynamic ->
            val target = e.target.closest("[data-pcx-s]") ?: return@addEventListener
            when (target.getAttribute("data-pcx-s") as String) {
                "x", "skip", "decline" -> close("dismissed")
                "back" -> close("answered")
                "claim" -> {
                    val id = target.getAttribute("data-offer") as String
                    close(if (pc.claimOffer(id)) "claimed" else "dismissed")
                }
                "send" -> {
                    val chosen = dialog.querySelector("input[name=pcx-s-r]:checked") ?: return@addEventListener
                    val code = chosen.value as String
                    val text = (
                        dialog.querySelector(
                            "[data-pcx-s-text=\"$code\"]",
                        )?.value as String?
                        )?.trim()?.ifEmpty {
                        null
                    }
                    target.disabled = true
                    target.textContent = "Sending…"
                    pc.answerSurvey(code, step, sku, text).then({ it }, { null }).then { w ->
                        when {
                            w?.action == "offer" && w.offer != null -> showOffer(w.offer!!)
                            w?.action == "message" && !w.message.isNullOrBlank() ->
                                dialog.innerHTML =
                                    messageHtml(w.message!!)
                            else -> close("answered")
                        }
                    }
                }
            }
        })
        dialog.showModal()
        pc.surveyShown(step, sku)
    }

private fun nowMs(): Double = js("Date.now()").unsafeCast<Double>()

/** "47:59" (hours:minutes) until [expiresAtIso]; "3d" past 99 hours; null once expired or unparseable. */
internal fun offerTimeLeft(expiresAtIso: String, nowMs: Double): String? {
    val end = js("Date.parse")(expiresAtIso).unsafeCast<Double>()
    if (end.isNaN()) return null
    val minutes = ((end - nowMs) / 60_000).toLong()
    if (minutes <= 0) return null
    val hours = minutes / 60
    return if (hours > 99) "${hours / 24}d" else "$hours:${(minutes % 60).toString().padStart(2, '0')}"
}

// ── HTML ─────────────────────────────────────────────────────────────────────────────────────

private const val X_BUTTON = """<button type="button" class="pcx-s-x" data-pcx-s="x" aria-label="Close">×</button>"""

/** The question and one radio per reason; a free-text reason carries its field. Send stays off until one is picked. */
internal fun surveyHtml(cfg: WebExitSurveyView): String {
    val reasons = cfg.reasons.joinToString("") { r ->
        val code = esc(r.code)
        val field = if (r.freeText) {
            """<textarea class="pcx-s-text" data-pcx-s-text="$code" maxlength="500" rows="3" placeholder="Tell us more (optional)" aria-label="${esc(
                r.label,
            )}"></textarea>"""
        } else {
            ""
        }
        """<div class="pcx-s-opt${if (r.freeText) " pcx-s-wide" else ""}"><label class="pcx-s-r"><input type="radio" name="pcx-s-r" value="$code"><span>${esc(
            r.label,
        )}</span></label>$field</div>"""
    }
    return """<form method="dialog" class="pcx-s-in" data-pcx-s-state="ask">$X_BUTTON<h2 class="pcx-s-h" id="pcx-s-h">${esc(
        cfg.title,
    )}</h2><fieldset class="pcx-s-list"><legend class="pcx-s-sr">${esc(
        cfg.title,
    )}</legend>$reasons</fieldset><div class="pcx-s-act"><button type="button" class="pcx-s-link" data-pcx-s="skip">Skip</button><button type="button" class="pcx-s-btn" data-pcx-s="send" data-pcx-s-send disabled>Send</button></div></form>"""
}

/** The discount the answer earned: the percentage up front, its terms, the price before → after, and the clock. */
internal fun offerHtml(o: WebOfferView, product: WebProductView?, timeLeft: String?): String {
    val pct = o.percentOff
    val term = when (o.duration) {
        "forever" -> "$pct% off for as long as you stay subscribed"
        "repeating" -> o.durationInMonths?.let { "$pct% off for $it months" } ?: "$pct% off your first payment"
        else -> "$pct% off your first payment"
    }
    val price = product?.let {
        """<p class="pcx-s-price">${esc(
            it.name,
        )} · <s class="pcx-s-was">${esc(formatMoney(it.amountCents, it.currency))}</s> <strong>${esc(
            formatMoney(discountedCents(it.amountCents, pct), it.currency),
        )}</strong></p>"""
    }.orEmpty()
    val ends = timeLeft?.let { """<p class="pcx-s-ends">Ends in ${esc(it)}</p>""" }.orEmpty()
    return """<div class="pcx-s-in pcx-s-off" data-pcx-s-state="offer">$X_BUTTON<p class="pcx-s-pct">$pct% off</p><h2 class="pcx-s-h" id="pcx-s-h">A better price, just for you</h2><p class="pcx-s-term">${esc(
        term,
    )}</p>$price$ends<button type="button" class="pcx-s-btn pcx-s-wide-btn" data-pcx-s="claim" data-offer="${esc(
        o.id,
    )}">Claim $pct% off</button><button type="button" class="pcx-s-link" data-pcx-s="decline">No thanks</button><p class="pcx-s-fine">Applied automatically at checkout. Limited time.</p></div>"""
}

/** The tenant's message for the answer (e.g. "We also accept UPI on our website") and the way back to paying. */
internal fun messageHtml(message: String): String =
    """<div class="pcx-s-in pcx-s-off" data-pcx-s-state="message">$X_BUTTON<p class="pcx-s-msg" id="pcx-s-h">${esc(
        message,
    )}</p><button type="button" class="pcx-s-btn pcx-s-wide-btn" data-pcx-s="back">Back to checkout</button><button type="button" class="pcx-s-link" data-pcx-s="decline">Close</button></div>"""

/**
 * Scoped to `.pcx-s`; the accent follows the checkout page's `--pcx-accent` / `--pcx-accent-fg` when the site set
 * them, and the dialog takes the page's colour scheme (`Canvas` / `CanvasText`) and font.
 */
internal const val SURVEY_CSS: String =
    ".pcx-s{--a:var(--pcx-accent,#111827);--af:var(--pcx-accent-fg,#fff);--ok:#059669;--l:color-mix(in oklab,CanvasText 14%,transparent);--m:color-mix(in oklab,CanvasText 62%,transparent);position:fixed;inset:0;margin:auto;border:0;padding:0;border-radius:20px;width:min(580px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;color:CanvasText;background:Canvas;font:inherit;box-shadow:0 24px 64px #0005}" +
        ".pcx-s::backdrop{background:#0009}.pcx-s *{box-sizing:border-box}@media (max-width:639px){.pcx-s{margin:auto 0 0;width:100%;max-width:100%;border-radius:20px 20px 0 0}}" +
        ".pcx-s-in{position:relative;display:grid;gap:14px;margin:0;padding:26px 24px 22px}.pcx-s-h{margin:0;padding-right:36px;font-size:20px;line-height:1.3;font-weight:700}" +
        ".pcx-s-x{position:absolute;top:14px;right:14px;width:32px;height:32px;border:0;border-radius:99px;background:var(--l);color:inherit;font-size:20px;line-height:1;cursor:pointer}" +
        ".pcx-s-list{display:grid;gap:10px;margin:0;padding:0;border:0;min-width:0}@media (min-width:640px){.pcx-s-list{grid-template-columns:1fr 1fr}}.pcx-s-wide{grid-column:1/-1}" +
        ".pcx-s-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}" +
        ".pcx-s-opt{border:1.5px solid var(--l);border-radius:14px}.pcx-s-opt:has(:checked){border-color:var(--a);box-shadow:0 0 0 1px var(--a)}" +
        ".pcx-s-r{display:flex;gap:12px;align-items:center;padding:13px 14px;font-size:15px;font-weight:500;cursor:pointer}.pcx-s-r input{margin:0;width:18px;height:18px;accent-color:var(--a)}" +
        ".pcx-s-text{display:none;width:calc(100% - 28px);margin:0 14px 14px;padding:10px 12px;border:1px solid var(--l);border-radius:10px;font:inherit;color:inherit;background:transparent;resize:vertical}.pcx-s-opt:has(:checked) .pcx-s-text{display:block}" +
        ".pcx-s-act{display:flex;gap:16px;justify-content:flex-end;align-items:center}" +
        ".pcx-s-btn{min-height:46px;padding:0 24px;border:0;border-radius:99px;background:var(--a);color:var(--af);font:inherit;font-size:15px;font-weight:600;cursor:pointer}.pcx-s-btn:disabled{opacity:.45;cursor:default}" +
        ".pcx-s-link{padding:8px;border:0;background:none;color:var(--m);font:inherit;font-size:14px;font-weight:500;cursor:pointer}.pcx-s-btn:focus-visible,.pcx-s-link:focus-visible,.pcx-s-x:focus-visible{outline:2px solid var(--a);outline-offset:2px}" +
        ".pcx-s-off{justify-items:center;text-align:center;gap:8px}.pcx-s-pct{margin:6px 0 0;font-size:40px;line-height:1.1;font-weight:800;color:var(--ok)}.pcx-s-off .pcx-s-h{padding:0}" +
        ".pcx-s-term,.pcx-s-price,.pcx-s-fine{margin:0;color:var(--m);font-size:15px}.pcx-s-price strong{color:CanvasText}.pcx-s-was{opacity:.8}.pcx-s-ends{margin:2px 0 6px;font-size:13px;font-weight:600;color:var(--ok)}" +
        ".pcx-s-wide-btn{width:100%;margin-top:10px}.pcx-s-fine{font-size:12.5px}.pcx-s-msg{margin:18px 0 6px;font-size:17px;line-height:1.5}"
