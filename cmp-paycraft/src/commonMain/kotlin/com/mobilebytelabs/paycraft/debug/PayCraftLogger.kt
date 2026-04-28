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
            Logger.d(TAG) { "refreshStatus() → checking status for: $email" }
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
                "✓ isPremium=true — email=$email, plan=$plan, provider=$provider, expires=$expiresAt, willRenew=$willRenew"
            }
        } else {
            Logger.d(TAG) { "isPremium=false for $email — no active subscription found" }
        }
    }

    fun onLogIn(email: String) {
        if (!enabled) return
        Logger.d(TAG) { "logIn($email) → saving + checking status..." }
    }

    fun onLogOut() {
        if (!enabled) return
        Logger.d(TAG) { "logOut() — clearing email + resetting to Free" }
    }

    // ── Network ──────────────────────────────────────────────────────────────

    fun onRpcCall(function: String, email: String) {
        if (!enabled) return
        Logger.d(TAG) { "RPC $function(email=$email)" }
    }

    fun onRpcResult(function: String, result: String) {
        if (!enabled) return
        Logger.d(TAG) { "  ↳ $function result: $result" }
    }

    fun onRpcError(function: String, message: String?) {
        if (!enabled) return
        Logger.e(TAG) { "  ✗ $function error: $message" }
    }

    // ── Error ────────────────────────────────────────────────────────────────

    fun onError(source: String, message: String?) {
        if (!enabled) return
        Logger.e(TAG) { "Error in $source: $message" }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun linkStatus(count: Int, total: Int, phase: String): String = when {
        count == total -> "✓ $count/$total configured"
        count == 0 -> "⚠ 0/$total — run /paycraft-adopt → $phase to create"
        else -> "⚠ $count/$total — run /paycraft-adopt → $phase to complete"
    }
}
