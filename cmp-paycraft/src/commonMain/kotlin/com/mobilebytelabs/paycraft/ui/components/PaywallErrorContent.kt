package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_error_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_retry
import org.jetbrains.compose.resources.stringResource

/**
 * Billing failed and the user can retry — the full-screen treatment, used only when there is no
 * paywall left to render (no tree). A purchase failure WITH a tree is [PaywallInlineError] instead.
 *
 * Distinct from [ConfigUnavailable], which covers the config FETCH failing before there is a paywall
 * at all. This one is reached once billing is running and a call went wrong, so the action offered
 * is a retry of that call rather than a reload of the surface.
 *
 * Stitch fatal-error: error tile with a status dot, headline, the message, a Retry pill and — because
 * a buyer who already paid can still recover their entitlement while billing is broken — the restore
 * link when [onRestore] is provided.
 */
@Composable
fun PaywallErrorContent(message: String, onRetry: () -> Unit, onRestore: (() -> Unit)? = null) {
    PaywallStateScreen(
        hero = {
            PaywallStateHero(
                icon = Icons.Outlined.ErrorOutline,
                title = stringResource(Res.string.paycraft_error_title),
                body = message,
                badgeColor = MaterialTheme.colorScheme.error,
            )
        },
        primary = { PaywallPrimaryButton(text = stringResource(Res.string.paycraft_retry), onClick = onRetry) },
        onRestore = onRestore,
    )
}
