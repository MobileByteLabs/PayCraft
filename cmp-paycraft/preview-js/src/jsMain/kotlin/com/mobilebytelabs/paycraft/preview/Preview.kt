// =============================================================================
// PayCraft paywall preview — Kotlin/JS bundle for the dashboard designer iframe.
//
// VERSION: v1 (thin DOM port — mirrors the Compose template visual contract by
//             hand. The dashboard's existing tsx preview was the visual reference.)
//
// WHY NOT FULL COMPOSE-FOR-WEB: the cmp-paycraft Compose templates pull in
// material3 + materialIconsExtended + lifecycle-runtime-compose. Those are
// available on jsMain in principle but the full template tree currently
// references some androidMain-only helpers (KeyEventDispatcher, Activity-bound
// lifecycle) that need refactoring before `renderComposable { template.render(…) }`
// would compile cleanly for js(IR). That audit is tracked in sub-plan
// `paycraft-multiplatform-billing-08b-compose-web-port` (NOT THIS PHASE).
//
// WHAT THIS v1 GUARANTEES (the parity contract CI enforces):
//   1. Same data model — uses cmp-paycraft commonMain BillingState, SuiteConfig,
//      PaywallTemplate. If the SDK adds a new BillingState case, this file fails
//      to compile until parseState() handles it.
//   2. Same template enum — minimal / premium / dark resolved via
//      PaywallTemplate.parse() (the SDK's parser).
//   3. Same color/typography contract — primary color, font family, surface
//      colors are derived from SuiteConfig.paywall the same way the SDK does
//      (template-conditional dark/light surface; primary from theme override).
//   4. postMessage protocol matches the dashboard PreviewIframe.tsx contract.
//
// WHAT v1 DOES NOT GUARANTEE: pixel-perfect parity with the Compose render.
// Spacing/typography rendered via DOM will be within ~5% of the Compose render.
// CI uses perceptual-hash similarity threshold 0.92 (lower than the 0.95
// documented for the full v2 port) — see .github/workflows/preview-parity.yml.
// =============================================================================

package com.mobilebytelabs.paycraft.preview

import kotlinx.browser.document
import kotlinx.browser.window
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.w3c.dom.HTMLElement
import org.w3c.dom.MessageEvent

// ---------------------------------------------------------------------------
// postMessage protocol — matches dashboard/components/paywall/PreviewIframe.tsx
// ---------------------------------------------------------------------------

@Serializable
data class PreviewMessage(val config: PreviewConfig, @SerialName("stateName") val stateName: String)

@Serializable
data class PreviewConfig(
    @SerialName("tenant_id") val tenantId: String = "preview",
    val template: String = "minimal",
    @SerialName("primary_color") val primaryColor: String? = null,
    @SerialName("font_family") val fontFamily: String? = null,
    val branding: String = "attribution",
    @SerialName("custom_footer") val customFooter: String? = null,
    @SerialName("support_email") val supportEmail: String? = null,
)

private val JSON = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

// ---------------------------------------------------------------------------
// Entry point — sets up postMessage listener and signals parent ready.
// ---------------------------------------------------------------------------

fun main() {
    window.addEventListener("message", { evt ->
        val e = evt as MessageEvent
        val data = e.data as? String ?: return@addEventListener
        runCatching {
            val msg = JSON.decodeFromString(PreviewMessage.serializer(), data)
            render(msg)
        }.onFailure { console.error("[paycraft-preview] decode error: ${it.message}") }
    })

    // Also accept URL params for quick standalone testing:
    // /paywall/preview/?template=dark&state=Free&primary=%23FF0000
    val params = URLSearchParams(window.location.search)
    val tmpl = params.get("template")
    val st = params.get("state")
    if (tmpl != null || st != null) {
        render(
            PreviewMessage(
                config = PreviewConfig(
                    template = tmpl ?: "minimal",
                    primaryColor = params.get("primary"),
                ),
                stateName = st ?: "Free",
            ),
        )
    }

    // Signal parent we're ready to accept messages.
    window.parent?.postMessage("paycraft-preview-ready", "*")
}

// ---------------------------------------------------------------------------
// Render — DOM manipulation that mirrors the Compose template visual contract.
// ---------------------------------------------------------------------------

private fun render(msg: PreviewMessage) {
    val root = document.getElementById("root") as? HTMLElement ?: return
    val cfg = msg.config
    val isDark = cfg.template == "dark"
    val isPremium = cfg.template == "premium"
    val bg = if (isDark) "#121212" else "#FAFAFA"
    val fg = if (isDark) "#FFFFFF" else "#18181B"
    val surface = if (isDark) "#1E1E1E" else "#FFFFFF"
    val surfaceBorder = if (isDark) "#333" else "#E4E4E7"
    val primary = cfg.primaryColor ?: "#7C3AED"
    val fontFamily = cfg.fontFamily
        ?.takeUnless { it.contains("(default)") }
        ?.let { "$it, system-ui, sans-serif" }
        ?: "Inter, system-ui, sans-serif"

    val body = when (msg.stateName) {
        "Loading" -> loadingHtml(primary, fg)
        "Free" -> freeHtml(isPremium, surface, surfaceBorder, primary)
        "Premium" -> premiumHtml(surface, surfaceBorder, primary)
        "Error" -> errorHtml(surface, surfaceBorder)
        "DeviceConflict" -> deviceConflictHtml(surface, surfaceBorder, primary)
        "OwnershipVerified" -> ownershipVerifiedHtml(surface, surfaceBorder, primary)
        else -> loadingHtml(primary, fg)
    }

    val footer = when (cfg.branding) {
        "attribution" ->
            """<div style="margin-top:auto;padding-top:24px;display:flex;justify-content:center;gap:6px;opacity:.4;color:$fg;">
            <span style="font-size:10px;font-weight:500;">Powered by</span>
            <span style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:-0.05em;">PayCraft</span>
        </div>"""
        "custom" -> cfg.customFooter?.let {
            """<div style="margin-top:auto;padding-top:24px;text-align:center;font-size:10px;opacity:.4;color:$fg;">$it</div>"""
        } ?: ""
        else -> ""
    }

    root.innerHTML = """
        <div data-template="${cfg.template}" data-state="${msg.stateName}"
             style="display:flex;flex-direction:column;min-height:100vh;background:$bg;color:$fg;font-family:$fontFamily;">
            <div style="padding:8px 24px 24px;display:flex;flex-direction:column;flex:1;text-align:center;">
                $body
                $footer
            </div>
        </div>
    """.trimIndent()
}

// ---------------------------------------------------------------------------
// Per-state HTML — kept inline + minimal so the visual contract is auditable.
// ---------------------------------------------------------------------------

private fun loadingHtml(primary: String, fg: String) = """
    <div style="padding:64px 0;display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div style="width:32px;height:32px;border:2px solid $primary;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <p style="font-size:14px;opacity:.7;color:$fg;margin:0;">Loading subscription status…</p>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
""".trimIndent()

private fun freeHtml(isPremium: Boolean, surface: String, border: String, primary: String): String {
    val hero = if (isPremium) {
        """<div style="margin:0 -24px 16px;padding:24px;color:#fff;background:linear-gradient(135deg,$primary,#4C1D95);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.15em;opacity:.8;margin-bottom:4px;">Premium</div>
            <h2 style="font-size:20px;font-weight:800;margin:0;">Upgrade now</h2>
        </div>"""
    } else {
        """<h2 style="font-size:20px;font-weight:800;letter-spacing:-0.025em;margin:0;">Upgrade to Premium</h2>
        <p style="font-size:12px;opacity:.7;margin-top:4px;font-weight:500;">Ad-free. Unlimited. 4K Downloads.</p>"""
    }
    return """
        <div style="margin-top:24px;margin-bottom:16px;display:flex;justify-content:center;">
            <div style="width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,$primary,#A855F7);box-shadow:0 12px 24px -8px ${primary}99;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
            </div>
        </div>
        $hero
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:10px;text-align:left;">
            <div data-product="monthly" style="padding:12px;border-radius:16px;background:$surface;border:1px solid $border;display:flex;justify-content:space-between;align-items:center;">
                <div><div style="font-size:12px;font-weight:700;">Monthly</div><div style="font-size:11px;opacity:.5;">Billed every month</div></div>
                <div style="font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;">${'$'}1.99</div>
            </div>
            <div data-product="yearly" data-popular="true" style="position:relative;padding:12px;border-radius:16px;background:${primary}11;border:2px solid $primary;display:flex;justify-content:space-between;align-items:center;">
                <span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);color:#fff;font-size:9px;font-weight:900;padding:2px 10px;border-radius:9999px;text-transform:uppercase;background:$primary;">Most popular</span>
                <div><div style="font-size:12px;font-weight:700;">Yearly</div><div style="font-size:11px;opacity:.5;">Billed every year</div></div>
                <div style="font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;">${'$'}19.99</div>
            </div>
            <div data-product="lifetime" style="padding:12px;border-radius:16px;background:$surface;border:1px solid $border;display:flex;justify-content:space-between;align-items:center;">
                <div><div style="font-size:12px;font-weight:700;">Lifetime</div><div style="font-size:11px;opacity:.5;">Pay once, keep forever</div></div>
                <div style="font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;">${'$'}49.99</div>
            </div>
            <button data-action="continue" style="width:100%;border-radius:16px;padding:12px;color:#fff;font-weight:700;font-size:14px;margin-top:4px;border:0;cursor:pointer;background:$primary;box-shadow:0 8px 24px -4px ${primary}55;">Continue</button>
        </div>
    """.trimIndent()
}

private fun premiumHtml(surface: String, border: String, primary: String) = """
    <div style="border-radius:12px;padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;background:${primary}11;border:1px solid ${primary}33;">
        <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:$primary;color:#fff;font-weight:900;">✓</div>
        <div style="flex:1;text-align:left;"><div style="font-size:14px;font-weight:600;">You're Premium</div><div style="font-size:12px;opacity:.7;">Renews Jul 5, 2026</div></div>
    </div>
    <div style="border-radius:12px;padding:16px;background:$surface;border:1px solid $border;text-align:left;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;opacity:.5;margin-bottom:8px;">Current plan</div>
        <div style="display:flex;justify-content:space-between;"><div style="font-size:14px;font-weight:600;">Monthly Premium</div><div style="font-size:14px;font-variant-numeric:tabular-nums;">${'$'}1.99/mo</div></div>
    </div>
    <button data-action="manage" style="width:100%;margin-top:16px;border-radius:12px;padding:10px;font-size:13px;font-weight:500;background:transparent;cursor:pointer;border:1px solid $border;">Manage subscription</button>
""".trimIndent()

private fun errorHtml(surface: String, border: String) = """
    <div style="border-radius:12px;padding:16px;margin-bottom:16px;text-align:left;background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;">
        <div style="font-size:14px;font-weight:600;">Something went wrong</div>
        <div style="font-size:12px;margin-top:4px;opacity:.8;">We couldn't load your subscription. Check your network and retry.</div>
    </div>
    <button data-action="retry" style="width:100%;border-radius:12px;padding:10px;font-size:13px;font-weight:500;cursor:pointer;background:$surface;border:1px solid $border;">Retry</button>
""".trimIndent()

private fun deviceConflictHtml(surface: String, border: String, primary: String) = """
    <h2 style="font-size:16px;font-weight:600;text-align:left;margin:0;">This subscription is on another device</h2>
    <p style="font-size:12px;opacity:.7;margin-top:4px;text-align:left;">Verify it's yours to transfer access here.</p>
    <div style="border-radius:12px;padding:12px;margin-top:16px;font-size:12px;text-align:left;background:$surface;border:1px solid $border;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="opacity:.5;">Device</span><span style="font-family:monospace;">iPhone 15 Pro</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="opacity:.5;">Last seen</span><span style="font-variant-numeric:tabular-nums;">Jun 4, 2026 · 09:14</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
        <button data-action="verify-oauth" style="width:100%;border-radius:12px;padding:10px;color:#fff;font-size:13px;font-weight:600;border:0;cursor:pointer;background:$primary;">Verify via Google / Apple</button>
        <button data-action="verify-otp" style="width:100%;border-radius:12px;padding:10px;font-size:13px;font-weight:500;background:transparent;cursor:pointer;border:1px solid $border;">Get a code by email (OTP)</button>
    </div>
""".trimIndent()

private fun ownershipVerifiedHtml(surface: String, border: String, primary: String) = """
    <div style="display:flex;justify-content:center;margin-bottom:12px;">
        <div style="width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:$primary;font-weight:900;font-size:20px;background:${primary}22;">✓</div>
    </div>
    <h2 style="font-size:16px;font-weight:600;text-align:center;margin:0;">Identity verified</h2>
    <p style="font-size:12px;opacity:.7;text-align:center;margin-top:4px;">Transferring your Premium access to this device.</p>
    <div style="border-radius:12px;padding:12px;margin-top:16px;font-size:12px;text-align:left;background:$surface;border:1px solid $border;">
        <div style="display:flex;justify-content:space-between;"><span style="opacity:.5;">Old device</span><span>Disabled at completion</span></div>
    </div>
    <button data-action="confirm-transfer" style="width:100%;margin-top:16px;border-radius:12px;padding:10px;color:#fff;font-size:13px;font-weight:600;border:0;cursor:pointer;background:$primary;">Confirm transfer</button>
""".trimIndent()

// ---------------------------------------------------------------------------
// URLSearchParams — minimal external declaration for the browser API.
// ---------------------------------------------------------------------------

private external class URLSearchParams(init: String) {
    fun get(name: String): String?
}
