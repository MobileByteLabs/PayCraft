package com.mobilebytelabs.paycraft.debug

import co.touchlab.kermit.Logger

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

    fun onInitialize(
        backendName: String,
        apiKeyPrefix: String,
        debug: Boolean,
    ) {
        if (!enabled) return
        Logger.d(TAG) { "══ PayCraft.initialize() ════════════════════════════" }
        Logger.d(TAG) { "  Backend  = $backendName" }
        Logger.d(TAG) { "  API key  = $apiKeyPrefix" }
        Logger.d(TAG) { "  Debug    = $debug" }
        Logger.d(TAG) { "══════════════════════════════════════════════════════" }
    }

    fun onConfigure(
        provider: String,
        modeLabel: String,
        planCount: Int,
        planIds: String,
        testLinks: Int,
        liveLinks: Int,
        supabaseUrl: String,
    ) {
        if (!enabled) return
        Logger.d(TAG) { "══ PayCraft.configure() ═════════════════════════════" }
        Logger.d(TAG) { "  Provider     = $provider | $modeLabel" }
        Logger.d(TAG) { "  Supabase URL = $supabaseUrl" }
        Logger.d(TAG) { "  Plans ($planCount): $planIds" }
        if (testLinks >= 0) {
            Logger.d(TAG) { "  Test links   = ${linkStatus(testLinks, planCount, "Phase 3 test")}" }
            Logger.d(TAG) { "  Live links   = ${linkStatus(liveLinks, planCount, "Phase 3 live")}" }
        }
        Logger.d(TAG) { "  Filter: adb logcat -s \"PayCraft:D\" \"*:S\"" }
        Logger.d(TAG) { "════════════════════════════════════════════════════" }
    }

    // ── Checkout ─────────────────────────────────────────────────────────────

    fun onCheckout(planId: String, mode: String, url: String) {
        if (!enabled) return
        Logger.d(TAG) { "checkout — plan=$planId, mode=$mode" }
        Logger.d(TAG) { "  Opening: $url" }
    }

    fun onManageSubscription(mode: String, url: String?) {
        if (!enabled) return
        Logger.d(TAG) { "manageSubscription — mode=$mode, url=${url ?: "⚠ portal URL not configured"}" }
    }

    // ── Billing state ────────────────────────────────────────────────────────

    fun onRefreshStatus(email: String?) {
        if (!enabled) return
        if (email == null) {
            Logger.d(TAG) { "refreshStatus() — no stored email → Free (UI should prompt sign-in)" }
        } else {
            Logger.d(TAG) { "refreshStatus() → checking status for: ${redactEmail(email)}" }
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
            Logger.d(TAG) {
                "✓ isPremium=true — email=${redactEmail(
                    email,
                )}, plan=$plan, provider=$provider, expires=$expiresAt, willRenew=$willRenew"
            }
        } else {
            Logger.d(TAG) { "isPremium=false for ${redactEmail(email)} — no active subscription found" }
        }
    }

    fun onLogIn(email: String) {
        if (!enabled) return
        Logger.d(TAG) { "logIn(${redactEmail(email)}) → saving + checking status..." }
    }

    fun onLogOut() {
        if (!enabled) return
        Logger.d(TAG) { "logOut() — clearing email + resetting to Free" }
    }

    // ── Network ──────────────────────────────────────────────────────────────

    fun onRpcCall(function: String, detail: String) {
        if (!enabled) return
        Logger.d(TAG) { "RPC $function($detail)" }
    }

    fun onRpcResult(function: String, result: String) {
        if (!enabled) return
        Logger.d(TAG) { "  ↳ $function result: $result" }
    }

    fun onRpcError(function: String, message: String?) {
        if (!enabled) return
        Logger.e(TAG) { "  ✗ $function error: $message" }
    }

    // ── Flow tracing (debug the billing pipeline) ─────────────────────────

    fun onFlow(method: String, detail: String) {
        if (!enabled) return
        Logger.d(TAG) { "[$method] $detail" }
    }

    fun onStateChange(from: String, to: String) {
        if (!enabled) return
        Logger.d(TAG) { "STATE: $from → $to" }
    }

    // ── Error ────────────────────────────────────────────────────────────────

    fun onError(source: String, message: String?) {
        if (!enabled) return
        Logger.e(TAG) { "Error in $source: $message" }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Redact email for safe logging: "rajanmaurya@gmail.com" → "r***@gmail.com" */
    private fun redactEmail(email: String?): String {
        if (email == null) return "null"
        val parts = email.split("@")
        if (parts.size != 2) return "***"
        return "${parts[0].take(1)}***@${parts[1]}"
    }

    private fun linkStatus(count: Int, total: Int, phase: String): String = when {
        count == total -> "✓ $count/$total configured"
        count == 0 -> "⚠ 0/$total — run /paycraft-adopt → $phase to create"
        else -> "⚠ $count/$total — run /paycraft-adopt → $phase to complete"
    }
}
