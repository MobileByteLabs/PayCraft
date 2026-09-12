package com.mobilebytelabs.paycraft.config

/**
 * The outcome of a config load, replacing the `SuiteConfig?` that four different situations used to
 * share.
 *
 * WHY A SEALED TYPE RATHER THAN A NULLABLE
 * `PayCraftPaywallComposable.kt:351` gates its skeleton on `config == null`, and null meant all of:
 * never fetched, fetch in flight, fetch returned HTTP 500, and device is offline. Three of those are
 * terminal and one is transient, but the UI cannot tell them apart, so it renders the same spinner
 * forever. On steady that spinner is in front of onboarding with a no-op dismiss, which strands an
 * offline user inside a shipped app.
 *
 * Each variant below answers a question the UI actually needs to ask: is there something to show,
 * how much should the user trust it, and is a retry worth offering.
 */
sealed interface ConfigResult {

    /** Nothing has been attempted yet. The ONLY state a loading spinner is correct for. */
    data object Loading : ConfigResult

    /** Layer 1 — a live response from the network. */
    data class Fresh(val config: SuiteConfig) : ConfigResult

    /** Layer 2 — persisted cache, still inside its TTL. Trustworthy; no warning needed. */
    data class Cached(val config: SuiteConfig) : ConfigResult

    /**
     * Layer 2 — persisted cache PAST its TTL. Renders, but the UI should say so: prices may have
     * moved. `ConfigCache.read()` signals this by returning a copy with `cacheTtlSeconds = 0`.
     */
    data class Stale(val config: SuiteConfig, val ageSeconds: Long) : ConfigResult

    /** Layer 3 — the per-platform fallback JSON shipped inside the app binary. */
    data class Bundled(val config: SuiteConfig) : ConfigResult

    /**
     * Layer 4 — nothing loaded at all. The UI renders a minimal purchasable surface from whatever
     * products it can name, plus a retry. Deliberately still a PAYWALL and not an error screen: a
     * user who wants to pay should be able to, even when config resolution has failed completely.
     */
    data object BuiltIn : ConfigResult

    /**
     * Every layer failed AND there is nothing purchasable to show. Terminal, and carries why so the
     * UI can distinguish "you are offline" from "something is broken on our side" — the retry
     * affordance is only honest for the first.
     */
    data class Failed(val reason: Reason, val detail: String? = null) : ConfigResult {
        enum class Reason { OFFLINE, HTTP_ERROR, DECODE_ERROR, NOT_INITIALIZED, UNKNOWN }
    }

    /**
     * The config to render, or null when there is nothing. Callers that only need "have I got
     * something to show" use this; callers that need to warn the user branch on the variant.
     */
    val configOrNull: SuiteConfig?
        get() = when (this) {
            is Fresh -> config
            is Cached -> config
            is Stale -> config
            is Bundled -> config
            Loading, BuiltIn -> null
            is Failed -> null
        }

    /** True only while a spinner is the honest thing to render. */
    val isLoading: Boolean get() = this == Loading

    /** True when the user should be told the data may be out of date. */
    val isStale: Boolean get() = this is Stale

    /**
     * True when a retry button is worth offering — the failure might actually be transient.
     *
     * DECODE_ERROR is excluded deliberately, and this used to be inconsistent: the code returned
     * true while PayCraft's own comment beside the throw site said offering retry for a malformed
     * payload "would be a lie". It would be — the server returned something unparseable, and asking
     * again returns the same thing. A button that cannot work is a dead clickable dressed as help.
     */
    val isRetryable: Boolean
        get() = when (this) {
            is Failed -> when (reason) {
                Failed.Reason.NOT_INITIALIZED -> false  // retry cannot start a billing stack
                Failed.Reason.DECODE_ERROR -> false     // the response is malformed, not flaky
                else -> true
            }
            BuiltIn, is Stale, is Bundled -> true
            Loading, is Fresh, is Cached -> false
        }
}
