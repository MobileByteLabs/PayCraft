package com.mobilebytelabs.paycraft.web

/** What [PayCraftWeb.mountCheckout] shows: the payment page, or a notice instead of it. */
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
 * Decides the page for [sku] — signed in, plan known, at least one provider that can charge its price —
 * and builds its model. No DOM: the browser half is [renderCheckout]. Only the network calls are suspending;
 * the decisions live in [checkoutViewFor] (a coroutine's state machine costs bundle bytes per local).
 */
internal suspend fun PayCraftWeb.checkoutView(sku: String, o: CheckoutPageOptions?): CheckoutView {
    if (email() == null) return checkoutViewFor(sku, o, null, 0)
    val cfg = try {
        loadConfig()
    } catch (e: Throwable) {
        null
    }
    // The seat count: known from this session's sign-in, else read from the account's device list.
    val seats = if (cfg == null || maxDevices() > 1) {
        maxDevices()
    } else {
        try {
            loadDevices().firstOrNull()?.maxDevices ?: 1
        } catch (e: Throwable) {
            1
        }
    }
    return checkoutViewFor(sku, o, cfg, seats)
}

private fun notice(title: String, body: String, label: String?, href: String?, back: String?) =
    CheckoutView.Notice(CheckoutNotice(title, body, label?.takeIf { href != null }, href, back))

internal fun PayCraftWeb.checkoutViewFor(sku: String, o: CheckoutPageOptions?, cfg: WebConfig?, seats: Int): CheckoutView {
    val back = o?.backUrl
    val email = email()
        ?: return notice(
            "Sign in to continue",
            "Your subscription is linked to your account, so it works in the app and on the web. " +
                "Sign in, then you'll come straight back here to pay.",
            "Sign in",
            o?.signInUrl,
            back,
        )
    cfg ?: return notice("Checkout couldn't load", "Check your connection or ad blocker, then try again.", "Try again", currentPage(), back)
    val product = cfg.products.firstOrNull { it.sku == sku }
        ?: return notice("This plan isn't available", "It may have changed since you opened this page. Pick a plan again.", "See plans", back, null)
    val options = paymentOptions(sku, null)
    if (options.isEmpty()) {
        return notice("Checkout isn't available on the website yet", "${product.name} can't be bought here right now. Please try again later.", null, null, back)
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
                CheckoutMethodCard(opt.provider, opt.name, paymentMethods(opt.provider, product.currency), i == 0 && options.size > 1)
            },
            backUrl = back,
            termsUrl = o?.termsUrl,
            refundUrl = o?.refundUrl,
        ),
    )
}

/** [amountCents] in [currency] for the buyer's locale ("₹299", "$9.90"); "9.9 XYZ" if Intl rejects the code. */
internal fun formatMoney(amountCents: Int, currency: String): String {
    val digits = if (amountCents % 100 == 0) 0 else 2
    return runCatching { intlCurrency(amountCents / 100.0, currency, digits) }.getOrElse { "${amountCents / 100.0} $currency" }
}

// A function expression with the formatter in its own variable: Kotlin's js() re-printer turns
// `new Intl.NumberFormat(…).format(v)` into `new (Intl.NumberFormat(…).format)(v)`, which throws — every
// price then fell back to "299 INR" (caught by the formatMoney test).
private val intlCurrency: (Double, String, Int) -> String = js(
    "(function (v, c, d) { var f = new Intl.NumberFormat(undefined, " +
        "{ style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }); return f.format(v); })",
)

// ── Browser half ─────────────────────────────────────────────────────────────────────────────

private const val STYLE_ID = "paycraft-checkout-style"

/** Puts the scoped styles on the page once and shows the loading state while [checkoutView] runs. */
internal fun prepareCheckout(el: dynamic) {
    val doc = el.ownerDocument
    if (doc.getElementById(STYLE_ID) == null) {
        val style = doc.createElement("style")
        style.id = STYLE_ID
        style.textContent = CHECKOUT_CSS
        doc.head.appendChild(style)
    }
    el.innerHTML = checkoutLoadingHtml()
}

/** Shows [view] in [el] and wires the radio cards + pay button. True when the payment page is shown. */
internal fun PayCraftWeb.renderCheckout(el: dynamic, sku: String, view: CheckoutView): Boolean = when (view) {
    is CheckoutView.Notice -> {
        el.innerHTML = checkoutNoticeHtml(view.notice)
        false
    }
    is CheckoutView.Ready -> {
        el.innerHTML = checkoutPageHtml(view.model)
        wireCheckout(el, sku, view.model)
        true
    }
}

private fun PayCraftWeb.wireCheckout(el: dynamic, sku: String, m: CheckoutModel) {
    val names = m.cards.associate { it.provider to it.name }
    var selected = m.cards.first().provider
    val pay = el.querySelector("[data-pcx-pay]")
    val payLabel = el.querySelector("[data-pcx-pay-label]")
    val providerName = el.querySelector("[data-pcx-provider-name]")
    val error = el.querySelector("[data-pcx-error]")
    val idleLabel = { "Continue to ${names[selected] ?: selected}" }

    val radios = el.querySelectorAll("input[name=pcx-provider]")
    for (i in 0 until (radios.length as Int)) {
        val r = radios.item(i)
        r.addEventListener("change", { _: dynamic ->
            selected = r.value as String
            payLabel.textContent = idleLabel()
            providerName.textContent = names[selected] ?: selected
            error.hidden = true
        })
    }
    fun reset() {
        pay.disabled = false
        payLabel.textContent = idleLabel()
    }
    fun fail(code: String?) {
        error.textContent = checkoutErrorMessage(code ?: "network_error")
        error.hidden = false
        reset()
    }
    // Back from the provider's page: the browser restores this page from the bfcache mid-"Opening…".
    el.ownerDocument.defaultView?.addEventListener("pageshow", { e: dynamic -> if (e.persisted == true) reset() })
    pay.addEventListener("click", { _: dynamic ->
        pay.disabled = true
        payLabel.textContent = "Opening ${names[selected] ?: selected}…"
        error.hidden = true
        checkoutUrlWith(sku, null, selected).then({ url ->
            // Only ever leave for an https page (the URL comes from tenant config / checkout-initiate).
            if (url.startsWith("https://")) navigate(url) else fail("bad_checkout_url")
        }, { e -> fail((e as? PayCraftWebError)?.code) })
    })
}
