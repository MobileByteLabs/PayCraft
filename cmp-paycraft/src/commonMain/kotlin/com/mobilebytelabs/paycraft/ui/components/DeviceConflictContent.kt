/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The DeviceConflict surface (AC-25) — three routes out of a state that was previously a dead end.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_account
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_support
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_support_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_title

/**
 * Host-supplied platform OAuth trigger.
 *
 * WHY THIS IS A COMPOSITION LOCAL AND NOT A BUTTON THAT JUST WORKS
 * `PayCraftPaywallAction.LoginWithOAuth` carries an `idToken`, and the SDK cannot produce one:
 * obtaining it means running Google/Apple sign-in with the host app's own client credentials and
 * entitlements. So the SDK asks, and the host answers by dispatching `LoginWithOAuth` once it has
 * a token.
 *
 * Null by default, and when it is null the OAuth gate is NOT RENDERED. A button that cannot
 * complete its own action is a dead clickable (RULE-IMPL-DEAD-CLICKABLE-001), and the other two
 * gates still get the user out.
 */
val LocalPayCraftOAuthHandler = staticCompositionLocalOf<((OAuthProvider) -> Unit)?> { null }

/** Convenience for hosts wiring the OAuth gate. */
@Composable
fun ProvidePayCraftOAuthHandler(
    handler: (OAuthProvider) -> Unit,
    content: @Composable () -> Unit,
) = CompositionLocalProvider(LocalPayCraftOAuthHandler provides handler, content = content)

/**
 * Renders the conflict payload and every route out of it.
 *
 * The previous body was two hardcoded lines — "Device limit reached" and "Sign in there or contact
 * support" — which discarded `conflictingDeviceName` and `supportEmail`. Telling someone to sign in on a device you decline to name, with no way to act
 * from here, is the definition of a dead end.
 */
@Composable
fun DeviceConflictContent(
    state: BillingState.DeviceConflict,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val oauthHandler = LocalPayCraftOAuthHandler.current

    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_device_conflict_title),
            style = MaterialTheme.typography.titleMedium,
        )

        // Naming the other device is the difference between an instruction and a dead end.
        val deviceName = state.conflictingDeviceName ?: "another device"
        Text(
            text = stringResource(Res.string.paycraft_device_conflict_body, deviceName),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_DEVICE_NAME),
        )

        Text(
            text = stringResource(Res.string.paycraft_device_conflict_account, state.email),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_EMAIL),
        )

        // ── Gate 1: OAuth — only when the host can actually complete it ────────────────────
        if (oauthHandler != null) {
            Button(
                onClick = { oauthHandler(OAuthProvider.GOOGLE) },
                modifier = Modifier.fillMaxWidth()
                    .testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE),
            ) { Text(stringResource(Res.string.paycraft_device_conflict_gate_oauth_google)) }

            OutlinedButton(
                onClick = { oauthHandler(OAuthProvider.APPLE) },
                modifier = Modifier.fillMaxWidth()
                    .testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_APPLE),
            ) { Text(stringResource(Res.string.paycraft_device_conflict_gate_oauth_apple)) }
        }

        // The emailed one-time-code gate was REMOVED 2026-09-06. It was the only self-service
        // route for custom-domain emails that cannot be linked to a Google or Apple account; those
        // users now go straight to the support route below. The explainer is unconditional because
        // it is the honest thing to show anyone whose email OAuth cannot serve.
        Text(
            text = stringResource(Res.string.paycraft_device_conflict_gate_support_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // ── Gate 2: manual transfer via support — ALWAYS present ──────────────────────────
        // Deliberately not conditional. It is the only route that does not depend on the user
        // still controlling the account's email, which is exactly the case where the other two
        // gates fail and someone is locked out of something they paid for.
        TextButton(
            onClick = { onAction(PayCraftPaywallAction.ContactSupportManualTransfer) },
            modifier = Modifier.fillMaxWidth()
                .testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT),
        ) {
            Text(
                text = stringResource(Res.string.paycraft_device_conflict_gate_support, state.supportEmail),
                modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_SUPPORT_EMAIL),
            )
        }
    }
}
