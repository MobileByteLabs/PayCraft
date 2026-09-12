package com.mobilebytelabs.paycraft.debug


/**
 * Central logging layer for PayCraft.
 *
 * All debug output flows through here — business logic classes emit structured
 * events, never raw log strings. One place to silence, one place to read.
 *
 * Consumer apps can disable in release builds:
 *   PayCraftLogger.enabled = BuildConfig.DEBUG
 *
 * Logcat filter:
 *   adb logcat -s "PayCraft:D" "*:S"
 */
object PayCraftLogger {

    private const val TAG = "PayCraft"

    /** Set to false in release builds to silence all PayCraft logs. */
    var enabled: Boolean = true

    // ── Configuration ────────────────────────────────────────────────────────

    fun onInitialize(backendName: String, apiKeyPrefix: String, debug: Boolean) {
        if (!enabled) return
        logD(TAG) { "══ PayCraft.initialize() ════════════════════════════" }
        logD(TAG) { "  Backend  = $backendName" }
        logD(TAG) { "  API key  = $apiKeyPrefix" }
        logD(TAG) { "  Debug    = $debug" }
        logD(TAG) { "══════════════════════════════════════════════════════" }
    }

    fun onSuiteConfigApplied(
        source: String,
        productCount: Int,
        providerCount: Int,
        primaryProvider: String,
        locale: String,
    ) {
        if (!enabled) return
        logD(TAG) { "══ PayCraft SuiteConfig applied ═════════════════════" }
        logD(TAG) { "  Source           = $source" }
        logD(TAG) { "  Products         = $productCount" }
        logD(TAG) { "  Providers        = $providerCount (primary=$primaryProvider)" }
        logD(TAG) { "  Locale           = $locale" }
        logD(TAG) { "  Filter: adb logcat -s \"PayCraft:D\" \"*:S\"" }
        logD(TAG) { "════════════════════════════════════════════════════" }
    }

    // ── Checkout ─────────────────────────────────────────────────────────────

    fun onCheckout(planId: String, mode: String, url: String) {
        if (!enabled) return
        logD(TAG) { "checkout — plan=$planId, mode=$mode" }
        logD(TAG) { "  Opening: $url" }
    }

    fun onManageSubscription(mode: String, url: String?) {
        if (!enabled) return
        logD(TAG) { "manageSubscription — mode=$mode, url=${url ?: "⚠ portal URL not configured"}" }
    }

    // ── Billing state ────────────────────────────────────────────────────────

    fun onRefreshStatus(email: String?) {
        if (!enabled) return
        if (email == null) {
            logD(TAG) { "refreshStatus() — no stored email → Free (UI should prompt sign-in)" }
        } else {
            logD(TAG) { "refreshStatus() → checking status for: ${redactEmail(email)}" }
        }
    }

    fun onStatusResult(
        email: String,
        isPremium: Boolean,
        plan: String?,
        provider: String?,
        expiresAt: String?,
        willRenew: Boolean,
    ) {
        if (!enabled) return
        if (isPremium) {
            logD(TAG) {
                "✓ isPremium=true — email=${redactEmail(
                    email,
                )}, plan=$plan, provider=$provider, expires=$expiresAt, willRenew=$willRenew"
            }
        } else {
            logD(TAG) { "isPremium=false for ${redactEmail(email)} — no active subscription found" }
        }
    }

    fun onLogIn(email: String) {
        if (!enabled) return
        logD(TAG) { "logIn(${redactEmail(email)}) → saving + checking status..." }
    }

    fun onLogOut() {
        if (!enabled) return
        logD(TAG) { "logOut() — clearing email + resetting to Free" }
    }

    // ── Network ──────────────────────────────────────────────────────────────

    fun onRpcCall(function: String, detail: String) {
        if (!enabled) return
        logD(TAG) { "RPC $function($detail)" }
    }

    fun onRpcResult(function: String, result: String) {
        if (!enabled) return
        logD(TAG) { "  ↳ $function result: $result" }
    }

    fun onRpcError(function: String, message: String?) {
        if (!enabled) return
        logE(TAG) { "  ✗ $function error: $message" }
    }

    // ── Flow tracing (debug the billing pipeline) ─────────────────────────

    fun onFlow(method: String, detail: String) {
        if (!enabled) return
        logD(TAG) { "[$method] $detail" }
    }

    fun onStateChange(from: String, to: String) {
        if (!enabled) return
        logD(TAG) { "STATE: $from → $to" }
    }

    // ── Error ────────────────────────────────────────────────────────────────

    fun onError(source: String, message: String?) {
        if (!enabled) return
        logE(TAG) { "Error in $source: $message" }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Redact email for safe logging: "rajanmaurya@gmail.com" → "r***@gmail.com" */
    private fun redactEmail(email: String?): String {
        if (email == null) return "null"
        val parts = email.split("@")
        if (parts.size != 2) return "***"
        return "${parts[0].take(1)}***@${parts[1]}"
    }
}

// ── Logging shim ─────────────────────────────────────────────────────────────
// Kermit was removed from PayCraft: it was a published transitive dependency doing nothing this
// SDK does not already do itself, and its version skewed against consumers (PayCraft 2.1.0 vs
// reels-downloader 2.0.8 crashed at launch on Logger$Companion.d$default; holding at the
// consumer's 2.0.5 broke this file with overload ambiguity). A dependency the SDK does not need
// cannot skew, so it is gone rather than pinned.
//
// These keep Kermit's exact call SHAPE — `logD(TAG) { "..." }` — so every existing trailing lambda
// is untouched and the message is still built lazily, only when logging is on.
private inline fun logD(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.DEBUG, tag, message())

private inline fun logW(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.WARN, tag, message())

private inline fun logE(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.ERROR, tag, message())
