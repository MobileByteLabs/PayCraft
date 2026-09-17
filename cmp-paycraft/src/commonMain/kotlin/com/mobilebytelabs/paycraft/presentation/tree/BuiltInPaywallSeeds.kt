package com.mobilebytelabs.paycraft.presentation.tree

import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import org.jetbrains.compose.resources.ExperimentalResourceApi

/**
 * The four templates, as component trees shipped inside the SDK.
 *
 * ## Why these exist in the binary at all
 * The gallery lives in the database (D21), because a tenant must be able to take a new template
 * without an app update. These copies answer a different question: what does the SDK render for a
 * tenant who has published NO tree? Today that falls back to the Kotlin templates — four hand-written
 * state machines that the renderer exists to replace. Pointing the fallback at the same seed the
 * gallery serves makes `paywall.template` a SEED SELECTION rather than a second rendering path, which
 * is the precondition for deleting those templates (D3).
 *
 * ## Failure behaviour is a null, not an exception
 * A missing or malformed bundled asset returns null so the caller can fall back rather than crash.
 * This is the paywall — the surface where a crash costs a subscription — and the SDK has been bitten
 * once already by a bundled-asset path that threw from a static initializer (D27).
 */
object BuiltInPaywallSeeds {

    private fun path(template: PaywallTemplate): String = when (template) {
        PaywallTemplate.BRANDED_STACK -> "files/paycraft/seed/branded_stack.json"
        PaywallTemplate.MINIMAL -> "files/paycraft/seed/minimal.json"
        PaywallTemplate.DARK -> "files/paycraft/seed/dark.json"
        PaywallTemplate.PREMIUM -> "files/paycraft/seed/premium.json"
    }

    /** Raw seed JSON for [template], or null if the bundled asset is missing/unreadable. */
    @OptIn(ExperimentalResourceApi::class)
    suspend fun json(template: PaywallTemplate): String? =
        runCatching { Res.readBytes(path(template)).decodeToString() }.getOrNull()

    /** Parsed seed tree for [template], or null if it is missing or does not parse. */
    suspend fun workflow(template: PaywallTemplate): PaywallWorkflow? = json(template)?.let(PaywallTreeParser::parse)
}
