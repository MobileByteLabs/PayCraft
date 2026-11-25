package com.mobilebytelabs.paycraft.analytics

/**
 * WHERE in a purchase attempt something went wrong (paycraft-attempt-observability GOAL D6) — the same closed set
 * the server's `attempt_events.stage` accepts, so an SDK failure and a webhook failure group side by side.
 */
public enum class PayCraftFailureStage(public val wire: String) {
    /** The SDK itself: a request that could not be sent, a checkout the paywall could not start. */
    Sdk("sdk"),

    /** PayCraft's server refused or crashed (checkout-initiate, register-*). */
    Server("server"),

    /** The payment provider or store said no: a declined card, a Play / StoreKit error code. */
    Provider("provider"),

    /** A provider's notification could not be verified or processed. */
    Webhook("webhook"),

    /** The money moved but the entitlement did not follow. */
    Entitlement("entitlement"),
}

/**
 * One failure, in the shape humans and the weekly digest group by (GOAL D6): a [stage], a short [errorClass]
 * (`store_connect`, `transport`, `paywall_vm`…), a [code] (`connect_6`, `transport_502`…) and a [message] that is
 * safe to store first-party.
 *
 * The message is made safe HERE, before it can reach any queue, log or wire: emails, phone and card numbers, API
 * keys and JWTs are masked, whitespace is collapsed, and it is cut to [MAX_FAILURE_MESSAGE] characters. The class and code
 * are lowercased into the same `[a-z0-9_:.-]` slugs (≤ 48) the server stores, so they group instead of scattering.
 * Only the class and code reach the app's own analytics ([PayCraftEvent.params]); the message goes to PayCraft's
 * ingest only, like an exit-survey's free text.
 */
public class PayCraftFailure(public val stage: PayCraftFailureStage, errorClass: String, code: String) {
    public val errorClass: String = failureSlug(errorClass)
    public val code: String = failureSlug(code)

    /** The scrubbed message, or empty when the failure carries none. */
    public var message: String = ""
        private set

    /**
     * A failure with a message, made safe here. A separate constructor so a bundle that only ever reports codes (the
     * browser SDK) does not carry the scrubbing rules (D16).
     */
    public constructor(stage: PayCraftFailureStage, errorClass: String, code: String, rawMessage: String) :
        this(stage, errorClass, code) {
        message = scrubFailureMessage(rawMessage).take(MAX_FAILURE_MESSAGE)
    }
}

/** The longest failure message stored (the server's `attempt_events.error_message` cap). */
public const val MAX_FAILURE_MESSAGE: Int = 200

/**
 * [raw] with emails, phone / card numbers, API keys and JWTs masked and whitespace collapsed. One rule set
 * ([FailureText]) on every platform; the browser runs it on the platform's own `RegExp`, so the web bundle does not
 * carry Kotlin's regex-replacement machinery (paycraft-attempt-observability D16, ≤ 150 KB).
 */
internal expect fun scrubFailureMessage(raw: String): String

/**
 * [raw] as a lowercase `[a-z0-9_:.-]` slug of at most 48 characters — the shape the server stores and groups by;
 * `unknown` when nothing is left.
 */
internal expect fun failureSlug(raw: String): String

/** The failure-text rules, on Kotlin's [Regex] — the actual for every platform except JS (which mirrors them). */
internal object FailureText {
    private const val MAX_SLUG = 48
    private val EMAIL = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+")
    private val KEYS =
        Regex("\\b(?:pk|sk|rk|pcsk|whsec|rzp)_(?:live|test)_[A-Za-z0-9]{6,}|\\b(?:sk|whsec|pcsk)_[A-Za-z0-9]{12,}")
    private val JWT = Regex("\\beyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")

    // 8+ digits with the separators people type: a phone number or a card number. Ends on a digit so the text
    // after it keeps its space.
    private val DIGITS = Regex("\\+?\\d[\\d\\s\\-().]{6,}\\d")
    private val SPACE = Regex("\\s+")
    private val NON_SLUG = Regex("[^a-z0-9_:.-]+")

    fun scrub(raw: String): String = raw
        .replace(EMAIL, "[email]")
        .replace(JWT, "[token]")
        .replace(KEYS, "[token]")
        .replace(DIGITS, "[number]")
        .replace(SPACE, " ")
        .trim()

    fun slug(raw: String): String = raw.lowercase().replace(NON_SLUG, "_").trim('_').take(MAX_SLUG).ifEmpty {
        "unknown"
    }
}
