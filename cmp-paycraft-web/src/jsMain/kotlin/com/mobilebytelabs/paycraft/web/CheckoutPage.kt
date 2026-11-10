package com.mobilebytelabs.paycraft.web

/**
 * Options for [PayCraftWeb.mountCheckout] — a plain object from JavaScript, every field optional:
 *
 * ```ts
 * await pc.mountCheckout(el, "pro_monthly", {
 *   features: ["No ads anywhere", "Download history"],
 *   backUrl: "/pricing/", signInUrl: "/signin/?plan=pro_monthly",
 *   termsUrl: "/terms/", refundUrl: "/refund/",
 * });
 * ```
 */
external interface CheckoutPageOptions {
    /** What the plan includes, listed in the order summary. */
    val features: Array<String>?

    /** "← Back" link target (the pricing page). Hidden when null. */
    val backUrl: String?

    /** Where a signed-out buyer signs in. Without it the page only says that sign-in is needed. */
    val signInUrl: String?

    /** Linked from the fine print under the pay button. */
    val termsUrl: String?
    val refundUrl: String?
}

/** One payment-method card on the page. */
internal class CheckoutMethodCard(
    val provider: String,
    val name: String,
    val info: PaymentMethodInfo,
    val recommended: Boolean,
)

/** Everything the ready page shows — built from config + session, rendered by [checkoutPageHtml]. */
internal class CheckoutModel(
    val planName: String,
    val price: String,
    /** "month", "3 months", "year"… or null for a one-time purchase. */
    val period: String?,
    val trialDays: Int?,
    val email: String?,
    /** Devices one subscription covers (the tenant's max_active_devices as last seen); < 2 → not mentioned. */
    val maxDevices: Int,
    val features: List<String>,
    val cards: List<CheckoutMethodCard>,
    val backUrl: String?,
    val termsUrl: String?,
    val refundUrl: String?,
)

/** A state other than the ready page: a message and at most one link onward. */
internal class CheckoutNotice(
    val title: String,
    val body: String,
    val actionLabel: String?,
    val actionHref: String?,
    val backUrl: String?,
)

internal fun periodLabel(interval: String?): String? = when (interval) {
    null, "" -> null
    "month" -> "month"
    "quarter" -> "3 months"
    "semiannual" -> "6 months"
    "year" -> "year"
    else -> interval
}

private fun billingLabel(period: String?): String = when (period) {
    null -> "One-time payment"
    "month" -> "Every month"
    "year" -> "Every year"
    else -> "Every $period"
}

internal fun esc(s: String): String =
    s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

/** Only same-page-safe link targets: relative paths and https URLs. Anything else (javascript:, data:) → null. */
internal fun safeHref(url: String?): String? {
    val u = url?.trim().orEmpty()
    if (u.isEmpty()) return null
    val lower = u.lowercase()
    return when {
        lower.startsWith("https://") -> u
        u.startsWith("/") && !u.startsWith("//") -> u
        u.startsWith("?") || u.startsWith("#") -> u
        else -> null
    }
}

// ── Icons (inline, generic — no third-party brand marks) ──────────────────────────────────────

private fun icon(path: String, cls: String = "pcx-ic"): String =
    """<svg class="$cls" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">$path</svg>"""

private val ICON_CHECK = """<path d="M20 6 9 17l-5-5"/>"""
private val ICON_LOCK = """<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>"""

private fun methodIcon(method: String): String = icon(
    when (method) {
        "UPI" -> """<path d="M7 4l5 16M12 4l5 16"/>"""
        "Cards" -> """<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>"""
        "Netbanking" -> """<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>"""
        "Wallets" -> """<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7z"/><path d="M4 7l11-3v3M16 13.5h.01"/>"""
        else -> """<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>""" // Apple Pay / Google Pay: a phone
    },
    "pcx-ic",
)

// ── HTML ─────────────────────────────────────────────────────────────────────────────────────

private fun backLink(href: String?, label: String = "Back to plans"): String =
    safeHref(href)?.let { """<a class="pcx-back" href="${esc(it)}">← ${esc(label)}</a>""" }.orEmpty()

private fun steps(): String = """<ol class="pcx-steps" aria-label="Checkout progress"><li class="pcx-step is-done"><span class="pcx-dot">${icon(ICON_CHECK, "pcx-ic pcx-ic-xs")}</span>Plan</li><li class="pcx-step is-done"><span class="pcx-dot">${icon(ICON_CHECK, "pcx-ic pcx-ic-xs")}</span>Account</li><li class="pcx-step is-current" aria-current="step"><span class="pcx-dot">3</span>Payment</li></ol>"""

internal fun checkoutLoadingHtml(): String =
    """<div class="pcx pcx-notice" data-pcx-state="loading" aria-busy="true"><p class="pcx-lead">Loading checkout…</p></div>"""

internal fun checkoutNoticeHtml(n: CheckoutNotice): String {
    val action = safeHref(n.actionHref)?.takeIf { n.actionLabel != null }
        ?.let { """<a class="pcx-pay pcx-pay-inline" href="${esc(it)}" data-pcx-action>${esc(n.actionLabel!!)}</a>""" }
        .orEmpty()
    return """<div class="pcx" data-pcx-state="notice">${backLink(n.backUrl)}<div class="pcx-notice" role="status"><h1 class="pcx-h1">${esc(n.title)}</h1><p class="pcx-lead">${esc(n.body)}</p>$action</div></div>"""
}

private fun methodCard(card: CheckoutMethodCard, checked: Boolean): String {
    val id = "pcx-m-${esc(card.provider)}"
    val chips = card.info.methods.joinToString("") { """<li class="pcx-chip">${methodIcon(it)}${esc(it)}</li>""" }
    val brands = card.info.cardBrands.takeIf { it.isNotEmpty() }
        ?.let { """<p class="pcx-brands">${it.joinToString(" · ") { b -> esc(b) }}</p>""" }.orEmpty()
    val note = card.info.note?.let { """<p class="pcx-note">${esc(it)}</p>""" }.orEmpty()
    val badge = if (card.recommended) """<span class="pcx-badge">Recommended</span>""" else ""
    return """<label class="pcx-method" for="$id" data-pcx-method="${esc(card.provider)}"><input type="radio" class="pcx-radio" name="pcx-provider" id="$id" value="${esc(card.provider)}"${if (checked) " checked" else ""}><span class="pcx-method-body"><span class="pcx-method-head"><span class="pcx-method-name">${esc(card.name)}</span>$badge</span><span class="pcx-method-sum">${esc(card.info.summary)}</span><ul class="pcx-chips" aria-label="Payment methods with ${esc(card.name)}">$chips</ul>$brands$note</span></label>"""
}

/** The ready page. The first card is pre-selected; [payLabel] names it on the button. */
internal fun checkoutPageHtml(m: CheckoutModel): String {
    val first = m.cards.first()
    val features = if (m.features.isEmpty()) "" else """<ul class="pcx-features">${m.features.joinToString("") { """<li>${icon(ICON_CHECK, "pcx-ic pcx-ok")}${esc(it)}</li>""" }}</ul>"""
    val trialRow = m.trialDays?.takeIf { it > 0 }
        ?.let { """<div class="pcx-row"><dt>Free trial</dt><dd>$it days</dd></div>""" }.orEmpty()
    val trialBadge = m.trialDays?.takeIf { it > 0 }
        ?.let { """<span class="pcx-trial">$it-day free trial</span>""" }.orEmpty()
    val per = m.period?.let { """<span class="pcx-per">/ ${esc(it)}</span>""" }.orEmpty()
    val account = m.email?.let {
        """<li>${icon(ICON_CHECK, "pcx-ic pcx-ok")}<span>Signed in as <strong>${esc(it)}</strong></span></li>"""
    }.orEmpty()
    val devices = if (m.maxDevices >= 2) {
        """<li>${icon(ICON_CHECK, "pcx-ic pcx-ok")}<span>One subscription for the app and the web — up to ${m.maxDevices} devices at a time</span></li>"""
    } else {
        ""
    }
    val legal = listOfNotNull(
        safeHref(m.termsUrl)?.let { """<a href="${esc(it)}">Terms</a>""" },
        safeHref(m.refundUrl)?.let { """<a href="${esc(it)}">Refund policy</a>""" },
    ).joinToString(" · ")
    val renew = if (m.period != null) "Renews automatically. Cancel any time." else "One-time payment."
    return """<div class="pcx" data-pcx-state="ready">${backLink(m.backUrl)}${steps()}<header class="pcx-head"><h1 class="pcx-h1">Checkout</h1><p class="pcx-lead">Choose how you'd like to pay. You'll finish on the provider's secure payment page.</p></header><div class="pcx-grid"><section class="pcx-methods" aria-labelledby="pcx-methods-h"><h2 class="pcx-h2" id="pcx-methods-h">Payment method</h2><div class="pcx-method-list" role="radiogroup" aria-labelledby="pcx-methods-h">${m.cards.mapIndexed { i, c -> methodCard(c, i == 0) }.joinToString("")}</div><p class="pcx-trust">${icon(ICON_LOCK)}<span>Payments are encrypted and processed by <strong data-pcx-provider-name>${esc(first.name)}</strong>. Your card and bank details are never shared with us.</span></p></section><aside class="pcx-summary" aria-labelledby="pcx-summary-h"><h2 class="pcx-h2" id="pcx-summary-h">Order summary</h2><div class="pcx-plan"><div class="pcx-plan-top"><span class="pcx-plan-name">${esc(m.planName)}</span>$trialBadge</div><p class="pcx-price"><span class="pcx-amount">${esc(m.price)}</span>$per</p></div><dl class="pcx-rows"><div class="pcx-row"><dt>Billing</dt><dd>${esc(billingLabel(m.period))}</dd></div>$trialRow<div class="pcx-row pcx-total"><dt>Total</dt><dd>${esc(m.price)}${m.period?.let { " / ${esc(it)}" }.orEmpty()}</dd></div></dl>$features<ul class="pcx-facts">$account$devices</ul><button type="button" class="pcx-pay" data-pcx-pay>${icon(ICON_LOCK)}<span data-pcx-pay-label>Continue to ${esc(first.name)}</span></button><p class="pcx-error" data-pcx-error role="alert" hidden></p><p class="pcx-fine">$renew${if (legal.isEmpty()) "" else " $legal"}</p></aside></div></div>"""
}

/**
 * The page's styles, scoped to `.pcx`; the variable defaults sit in `:where(.pcx)` (zero specificity) so a
 * site's own `.pcx { … }` wins whichever stylesheet loads last. It inherits the host page's font and text colour, so it sits in any
 * site without configuration. The accent (button, selection) defaults to near-black; a site matches its brand
 * and its dark theme by setting the variables, e.g.
 * `.pcx { --pcx-accent: #6d28d9; --pcx-accent-fg: #fff; --pcx-radius: 16px; }`.
 */
internal const val CHECKOUT_CSS: String =
    ":where(.pcx){--pcx-accent:#111827;--pcx-accent-fg:#fff;--pcx-radius:18px;--pcx-ok:#059669;--l:color-mix(in oklab,currentColor 14%,transparent);--s:color-mix(in oklab,currentColor 4%,transparent);--m:color-mix(in oklab,currentColor 62%,transparent);container-type:inline-size;max-width:1040px;margin:0 auto}" +
        ".pcx *{box-sizing:border-box}.pcx-ic{width:16px;height:16px;flex:none}.pcx-ic-xs{width:12px;height:12px}.pcx-ok{color:var(--pcx-ok)}" +
        ".pcx-back,.pcx-steps,.pcx-lead,.pcx-h2,.pcx-method-sum,.pcx-brands,.pcx-note,.pcx-trust,.pcx-per,.pcx-row dt,.pcx-facts,.pcx-fine{color:var(--m)}" +
        ".pcx-back{display:inline-flex;align-items:center;gap:4px;font-size:14px;font-weight:500;text-decoration:none}" +
        ".pcx-steps{display:flex;flex-wrap:wrap;gap:6px 20px;list-style:none;margin:20px 0 0;padding:0;font-size:13px;font-weight:500}" +
        ".pcx-step{display:flex;align-items:center;gap:8px}.pcx-dot{display:grid;place-items:center;width:22px;height:22px;border-radius:99px;border:1px solid var(--l);font-size:11px;font-weight:700}" +
        ".is-done .pcx-dot{background:var(--pcx-ok);border-color:var(--pcx-ok);color:#fff}.is-current{color:inherit}.is-current .pcx-dot,.pcx-pay{background:var(--pcx-accent);color:var(--pcx-accent-fg);border-color:var(--pcx-accent)}" +
        ".pcx-head{margin:22px 0 26px}.pcx-h1{margin:0;font-size:clamp(1.75rem,4.2cqi,2.4rem);line-height:1.1;font-weight:700;letter-spacing:-.025em}" +
        ".pcx-lead{margin:10px 0 0;font-size:15px;line-height:1.55;max-width:36rem}.pcx-h2{margin:0 0 14px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}" +
        ".pcx-grid{display:grid;gap:22px}@container (min-width:820px){.pcx-grid{grid-template-columns:1.35fr 1fr;gap:32px;align-items:start}.pcx-summary{position:sticky;top:88px}}" +
        ".pcx-method-list{display:grid;gap:12px}.pcx-method{display:flex;gap:14px;padding:18px 18px 18px 16px;border:1.5px solid var(--l);border-radius:var(--pcx-radius);cursor:pointer}" +
        ".pcx-method:has(:checked){border-color:var(--pcx-accent);background:var(--s);box-shadow:0 0 0 1px var(--pcx-accent)}.pcx-method:has(:focus-visible),.pcx-pay:focus-visible{outline:2px solid var(--pcx-accent);outline-offset:2px}" +
        ".pcx-radio{appearance:none;margin:2px 0 0;width:20px;height:20px;flex:none;border-radius:99px;border:1.5px solid var(--m);display:grid;place-items:center}" +
        ".pcx-radio:checked{border-color:var(--pcx-accent)}.pcx-radio:checked:after{content:'';width:10px;height:10px;border-radius:99px;background:var(--pcx-accent)}" +
        ".pcx-method-body{flex:1;min-width:0}.pcx-method-head,.pcx-plan-top{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.pcx-method-name,.pcx-plan-name{font-size:16px;font-weight:650}" +
        ".pcx-badge,.pcx-trial{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:99px;color:var(--pcx-ok);background:color-mix(in oklab,var(--pcx-ok) 12%,transparent)}" +
        ".pcx-method-sum{display:block;margin-top:2px;font-size:14px}.pcx-chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:14px 0 0;padding:0}" +
        ".pcx-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border:1px solid var(--l);border-radius:10px;font-size:13px;font-weight:500}" +
        ".pcx-brands,.pcx-note{margin:8px 0 0;font-size:12.5px}.pcx-trust{display:flex;gap:10px;margin:16px 0 0;padding:12px 14px;border-radius:12px;background:var(--s);font-size:13px;line-height:1.5}" +
        ".pcx strong{color:inherit;font-weight:600}.pcx-summary{padding:22px;border:1px solid var(--l);border-radius:var(--pcx-radius);background:var(--s)}" +
        ".pcx-price{margin:8px 0 0;display:flex;align-items:baseline;gap:6px}.pcx-amount{font-size:2.1rem;font-weight:700}.pcx-per{font-size:14px}" +
        ".pcx-rows,.pcx-features,.pcx-facts{margin:18px 0 0;padding:0;display:grid;gap:9px;font-size:14px;list-style:none}.pcx-rows,.pcx-facts{padding-top:14px;border-top:1px solid var(--l)}" +
        ".pcx-row{display:flex;justify-content:space-between;gap:12px}.pcx-row dd{margin:0;font-weight:500;text-align:right}.pcx-total{padding-top:10px;border-top:1px dashed var(--l);font-size:15px;font-weight:700}" +
        ".pcx-features li,.pcx-facts li{display:flex;gap:10px;align-items:flex-start;line-height:1.45}.pcx li>.pcx-ic{margin-top:2px}.pcx-facts strong{word-break:break-all}" +
        ".pcx-pay{margin-top:20px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:0 20px;border:0;border-radius:99px;font:inherit;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none}" +
        ".pcx-pay:disabled{opacity:.6;cursor:progress}.pcx-pay-inline{width:auto;margin-top:22px}" +
        ".pcx-error{margin:12px 0 0;padding:10px 12px;border-radius:10px;font-size:13.5px;color:#b91c1c;background:#ef44441a}" +
        ".pcx-fine{margin:12px 0 0;font-size:12.5px;text-align:center}.pcx-fine a{color:inherit}.pcx-notice{max-width:32rem;margin:40px auto 0;text-align:center}.pcx-notice .pcx-lead{margin-inline:auto}"
