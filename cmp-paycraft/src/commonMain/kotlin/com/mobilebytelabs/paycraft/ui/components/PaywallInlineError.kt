package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * A billing failure reported WITHOUT taking the paywall down.
 *
 * ## The bug this exists to fix
 * A `BillingState.Error` replaced the whole surface with a full-screen "Something went wrong". Found
 * in a real app: cappy's Play catalogue has no products yet, so tapping Continue on the ANNUAL plan
 * wiped out the hero, both plans, both prices and the monthly plan the user could still have bought
 * — leaving one Retry button that fails identically every time. One unavailable SKU took down the
 * entire paywall.
 *
 * A purchase that fails is not a paywall that failed. The plans stay on screen; this says what went
 * wrong above them.
 *
 * ## The message is for a customer, not for us
 * "Product not found on Play: com.mobilebytesensei.cappy.sub.year" is a developer's sentence shown to
 * someone trying to pay. [humanBillingError] maps the ones we can recognise onto something a person
 * can act on; the raw text keeps going to [com.mobilebytelabs.paycraft.core.PayCraftLogger], which is
 * where it is useful.
 */
@Composable
fun PaywallInlineError(message: String, onRetry: () -> Unit) {
    val tokens = PayCraftTheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .background(tokens.colors.accent.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = humanBillingError(message),
                color = tokens.colors.onSurface,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        TextButton(onClick = onRetry) {
            Text("Retry", color = tokens.colors.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * Turn a billing failure into a sentence a paying customer can act on.
 *
 * Unrecognised failures fall through to a generic line rather than leaking internals: a store id or
 * an HTTP code tells the user nothing and reads as a broken app.
 */
internal fun humanBillingError(raw: String): String = when {
    // ── Store could not match THIS BUILD, so no plan will work ────────────────────────────────
    // Play answers "Product not found on Play: <sku>" for two very different situations, and the
    // common one is NOT a missing product. Play serves in-app products only to a build whose
    // package AND signing certificate match something distributed through Play, at a versionCode
    // the track knows. A debug-signed / sideloaded APK therefore gets "not found" while the SKU is
    // sitting right there in the Console — measured on cappy 2026-09-17: storeBinding resolved
    // `com.mobilebytesensei.cappy.sub.year` correctly, Play still refused, and the APK was
    // `CN=Android Debug`, versionCode 1.
    //
    // "Try another plan" was the old copy here and it is actively wrong for this class: every plan
    // fails identically, so it walks the user in a circle.
    raw.contains("not found on play", ignoreCase = true) ||
        raw.contains("item_unavailable", ignoreCase = true) ||
        raw.contains("billing_unavailable", ignoreCase = true) ->
        "Purchases aren't available in this build. Install the app from the store to subscribe."

    // ── This ONE plan is misconfigured — a different plan genuinely may work ───────────────────
    // "Google Play product not configured for plan <uuid> (native digital)" / "product id missing
    // for <uuid>": the plan exists in PayCraft but carries no store binding.
    raw.contains("not configured", ignoreCase = true) ||
        raw.contains("product id missing", ignoreCase = true) ->
        "This plan isn't available right now. Try another plan, or check back soon."

    // ── The host app never loaded a billing module — a developer error, not a user one ─────────
    raw.contains("no nativebillingclient", ignoreCase = true) ||
        raw.contains("billing module", ignoreCase = true) ->
        "Purchases aren't set up in this app yet."

    raw.contains("not found", ignoreCase = true) ||
        raw.contains("unavailable", ignoreCase = true) ->
        "This plan isn't available right now. Try another plan, or check back soon."

    raw.contains("cancel", ignoreCase = true) -> "Purchase cancelled."

    raw.contains("network", ignoreCase = true) ||
        raw.contains("timeout", ignoreCase = true) ||
        raw.contains("offline", ignoreCase = true) ->
        "We couldn't reach the store. Check your connection and try again."

    raw.contains("already", ignoreCase = true) ->
        "You already own this. Try Restore Purchases."

    else -> "Something went wrong with that purchase. Please try again."
}
