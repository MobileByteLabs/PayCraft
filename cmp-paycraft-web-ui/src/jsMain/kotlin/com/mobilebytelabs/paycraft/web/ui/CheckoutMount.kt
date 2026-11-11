package com.mobilebytelabs.paycraft.web.ui

import kotlin.js.Promise

/**
 * PayCraft's checkout page for [sku], rendered into [container] (an empty element on the site's own `/checkout`
 * page) for the buyer signed in on [pc] (the page's `PayCraftWeb`): the order summary, a card per provider listing
 * every way it can take this buyer's price (UPI, cards, netbanking, wallets, Apple Pay, Google Pay — what the
 * currency allows), and the pay button that hands over to the chosen provider's secure page. Signed out, an unknown
 * plan or no provider show a notice instead. Leaving without paying ("Back", or the pointer heading for the tab
 * bar) asks the tenant's exit survey first, unless `options.exitSurvey` is false. Styles are scoped to `.pcx` and
 * inherit the site's font and colour; brand it with `--pcx-accent`, `--pcx-accent-fg` and `--pcx-radius`.
 * Resolves true when the payment page is shown.
 */
@JsExport
fun mountCheckout(pc: dynamic, container: dynamic, sku: String, options: dynamic): Promise<Boolean> {
    val api = pc.unsafeCast<PayCraftWebApi>()
    val o = options?.unsafeCast<CheckoutPageOptions>()
    prepareCheckout(container)
    return checkoutView(api, sku, o).then { view -> renderCheckout(api, container, sku, view, o?.exitSurvey != false) }
}

/** What [mountCheckout] shows: the payment page, or a notice instead of it. */
internal sealed class CheckoutView {
    class Ready(val model: CheckoutModel) : CheckoutView()
    class Notice(val notice: CheckoutNotice) : CheckoutView()
}

/** The message a buyer reads for each checkout error code (PayCraftWebError.code). */
internal fun checkoutErrorMessage(code: String?): String = when (code) {
    "sign_in_required" -> "Your session has ended. Sign in again to continue."
    "unknown_sku" -> "This plan is no longer available. Go back and pick a plan again."
    "no_payment_link", "no_web_provider" -> "This payment method can't take payments right now. Try another one."
    "bad_checkout_url" -> "Checkout is misconfigured. Please contact support."
    "network_error" -> "Couldn't reach the payment page. Check your connection or ad blocker and try again."
    else -> "Checkout failed. Please try again."
}

/**
 * Decides the page for [sku] — signed in, plan known, at least one provider that can charge its price — and builds
 * its model. Only the reads are asynchronous; the decisions live in [checkoutViewFor].
 */
internal fun checkoutView(pc: PayCraftWebApi, sku: String, o: CheckoutPageOptions?): Promise<CheckoutView> {
    if (pc.email() == null) return Promise.resolve(checkoutViewFor(pc, sku, o, null, 0))
    return pc.config().then({ it.unsafeCast<WebConfigView?>() }, { null }).then { cfg ->
        // The seat count: known from this session's sign-in, else read from the account's device list.
        if (cfg == null || pc.maxDevices() > 1) {
            Promise.resolve(checkoutViewFor(pc, sku, o, cfg, pc.maxDevices()))
        } else {
            pc.devices().then(
                { d -> checkoutViewFor(pc, sku, o, cfg, d.firstOrNull()?.maxDevices ?: 1) },
                { checkoutViewFor(pc, sku, o, cfg, 1) },
            )
        }
    }.unsafeCast<Promise<CheckoutView>>()
}

private fun notice(title: String, body: String, label: String?, href: String?, back: String?) =
    CheckoutView.Notice(CheckoutNotice(title, body, label?.takeIf { href != null }, href, back))

internal fun checkoutViewFor(
    pc: PayCraftWebApi,
    sku: String,
    o: CheckoutPageOptions?,
    cfg: WebConfigView?,
    seats: Int,
): CheckoutView {
    val back = o?.backUrl
    val email = pc.email()
        ?: return notice(
            "Sign in to continue",
            "Your subscription is linked to your account, so it works in the app and on the web. " +
                "Sign in, then you'll come straight back here to pay.",
            "Sign in",
            o?.signInUrl,
            back,
        )
    cfg
        ?: return notice(
            "Checkout couldn't load",
            "Check your connection or ad blocker, then try again.",
            "Try again",
            currentPage(),
            back,
        )
    val product = cfg.products.firstOrNull { it.sku == sku }
        ?: return notice(
            "This plan isn't available",
            "It may have changed since you opened this page. Pick a plan again.",
            "See plans",
            back,
            null,
        )
    val options = pc.paymentOptions(sku, null)
    if (options.isEmpty()) {
        return notice(
            "Checkout isn't available on the website yet",
            "${product.name} can't be bought here right now. Please try again later.",
            null,
            null,
            back,
        )
    }
    return CheckoutView.Ready(
        CheckoutModel(
            planName = product.name,
            price = formatMoney(product.amountCents, product.currency),
            period = periodLabel(product.interval),
            trialDays = product.trialDays,
            email = email,
            maxDevices = seats,
            features = o?.features?.filter { it.isNotBlank() }.orEmpty(),
            cards = options.mapIndexed { i, opt ->
                CheckoutMethodCard(
                    opt.provider,
                    opt.name,
                    opt.methodList.toList(),
                    opt.cardBrands.toList(),
                    opt.note,
                    opt.methods,
                    i == 0 && options.size > 1,
                )
            },
            backUrl = back,
            termsUrl = o?.termsUrl,
            refundUrl = o?.refundUrl,
            currency = product.currency,
            amountCents = product.amountCents,
        ),
    )
}

/** [amountCents] in [currency] for the buyer's locale ("₹299", "$9.90"); "9.9 XYZ" if Intl rejects the code. */
internal fun formatMoney(amountCents: Int, currency: String): String {
    val digits = if (amountCents % 100 == 0) 0 else 2
    return runCatching {
        intlCurrency(amountCents / 100.0, currency, digits)
    }.getOrElse { "${amountCents / 100.0} $currency" }
}

// A function expression with the formatter in its own variable: Kotlin's js() re-printer turns
// `new Intl.NumberFormat(…).format(v)` into `new (Intl.NumberFormat(…).format)(v)`, which throws — every
// price then fell back to "299 INR" (caught by the formatMoney test).
private val intlCurrency: (Double, String, Int) -> String = js(
    "(function (v, c, d) { var f = new Intl.NumberFormat(undefined, " +
        "{ style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }); return f.format(v); })",
)

/** The page checkout starts from ("Try again" reloads it). Null off-browser. */
internal fun currentPage(): String? =
    js("(typeof location !== 'undefined' && location.href) ? location.href : null").unsafeCast<String?>()

// ── Browser half ─────────────────────────────────────────────────────────────────────────────

private const val STYLE_ID = "paycraft-checkout-style"

/** Puts the scoped styles on the page once and shows the loading state while [checkoutView] runs. */
internal fun prepareCheckout(el: dynamic) {
    addStyleOnce(el.ownerDocument, STYLE_ID, CHECKOUT_CSS)
    el.innerHTML = checkoutLoadingHtml()
}

internal fun addStyleOnce(doc: dynamic, id: String, css: String) {
    if (doc.getElementById(id) == null) {
        val style = doc.createElement("style")
        style.id = id
        style.textContent = css
        doc.head.appendChild(style)
    }
}

/** Shows [view] in [el] and wires the radio cards + pay button. True when the payment page is shown. */
internal fun renderCheckout(pc: PayCraftWebApi, el: dynamic, sku: String, view: CheckoutView, survey: Boolean): Boolean =
    when (view) {
        is CheckoutView.Notice -> {
            el.innerHTML = checkoutNoticeHtml(view.notice)
            false
        }
        is CheckoutView.Ready -> {
            el.innerHTML = checkoutPageHtml(view.model)
            wireCheckout(pc, el, sku, view.model, survey)
            true
        }
    }

private fun wireCheckout(pc: PayCraftWebApi, el: dynamic, sku: String, m: CheckoutModel, survey: Boolean) {
    // A scan, not `associate`: a map would ship the stdlib's HashMap to every buyer for two or three entries.
    val nameOf = { p: String -> m.cards.firstOrNull { it.provider == p }?.name ?: p }
    var selected = m.cards.first().provider
    val win = el.ownerDocument.defaultView
    val pay = el.querySelector("[data-pcx-pay]")
    val payLabel = el.querySelector("[data-pcx-pay-label]")
    val providerName = el.querySelector("[data-pcx-provider-name]")
    val error = el.querySelector("[data-pcx-error]")
    val offerNote = el.querySelector("[data-pcx-offer]")
    val idleLabel = { "Continue to ${nameOf(selected)}" }
    // A discount claimed from the exit survey (now, or earlier in this page's life) shows in the summary.
    val showOffer = {
        pc.activeOffer()?.let {
            offerNote.textContent = offerAppliedLabel(it, m.amountCents, m.currency)
            offerNote.hidden = false
        }
    }
    showOffer()

    // Paywall events: the payment-method step was shown; leaving without paying is an abandon there.
    var paying = false
    pc.checkoutEvent("view", sku, m.currency, selected, null)
    win?.addEventListener("pagehide", { _: dynamic ->
        pc.checkoutEvent(if (paying) "leave" else "abandon", sku, m.currency, selected, null)
    })

    val radios = el.querySelectorAll("input[name=pcx-provider]")
    for (i in 0 until (radios.length as Int)) {
        val r = radios.item(i)
        r.addEventListener("change", { _: dynamic ->
            selected = r.value as String
            pc.checkoutEvent("select", sku, m.currency, selected, null)
            payLabel.textContent = idleLabel()
            providerName.textContent = nameOf(selected)
            error.hidden = true
        })
    }
    fun reset() {
        pay.disabled = false
        payLabel.textContent = idleLabel()
    }
    fun fail(code: String?) {
        paying = false
        pc.checkoutEvent("fail", sku, m.currency, selected, code ?: "network_error")
        error.textContent = checkoutErrorMessage(code ?: "network_error")
        error.hidden = false
        reset()
    }
    // Back from the provider's page: the browser restores this page from the bfcache mid-"Opening…".
    win?.addEventListener("pageshow", { e: dynamic -> if (e.persisted == true) reset() })
    pay.addEventListener("click", { _: dynamic ->
        pay.disabled = true
        paying = true
        pc.checkoutEvent("start", sku, m.currency, selected, null)
        payLabel.textContent = "Opening ${nameOf(selected)}…"
        error.hidden = true
        pc.checkoutUrlWith(sku, null, selected).then({ url ->
            // Only ever leave for an https page (the URL comes from tenant config / checkout-initiate).
            if (url.startsWith("https://")) win.location.assign(url) else fail("bad_checkout_url")
        }, { e -> fail(e.asDynamic()?.code as? String) })
    })

    if (!survey) return
    // Leaving without paying asks why — once per page, and the survey's own cap decides whether it shows at all.
    var asked = false
    fun ask(then: () -> Unit) {
        if (asked || paying) return then()
        asked = true
        showExitSurvey(pc, "provider", sku).then { outcome ->
            if (outcome == "claimed") showOffer() else then()
        }
    }
    el.querySelector(".pcx-back")?.addEventListener("click", { e: dynamic ->
        val href = e.currentTarget.href as String
        e.preventDefault()
        ask { win.location.assign(href) }
    })
    // Exit intent on a desktop: the pointer leaves through the top edge, toward the tabs and the address bar.
    el.ownerDocument.addEventListener("mouseout", { e: dynamic ->
        if (e.relatedTarget == null && (e.clientY as Number).toInt() <= 0) ask {}
    })
}

/** "50% off applied — ₹149.50 for the first payment" for the order summary. */
internal fun offerAppliedLabel(o: WebOfferView, amountCents: Int?, currency: String?): String {
    val price = if (amountCents != null && currency != null) " — ${formatMoney(discountedCents(amountCents, o.percentOff), currency)}" else ""
    val term = when (o.duration) {
        "forever" -> ""
        "repeating" -> o.durationInMonths?.let { " for $it months" }.orEmpty()
        else -> " on the first payment"
    }
    return "${o.percentOff}% off applied$price$term"
}

/** [amountCents] with [percentOff] taken off, rounded to the nearest minor unit (half up), as Stripe and Razorpay round a percentage discount. */
internal fun discountedCents(amountCents: Int, percentOff: Int): Int =
    (amountCents.toLong() * (100 - percentOff.coerceIn(0, 100)) + 50).div(100).toInt()
