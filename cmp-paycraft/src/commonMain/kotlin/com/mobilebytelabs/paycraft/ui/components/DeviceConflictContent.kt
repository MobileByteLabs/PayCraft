/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The DeviceConflict surface (AC-25) — three routes out of a state that was previously a dead end.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_account
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_support
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_support_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_other_device
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_title
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallAction
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

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
fun ProvidePayCraftOAuthHandler(handler: (OAuthProvider) -> Unit, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalPayCraftOAuthHandler provides handler, content = content)

/**
 * Renders the conflict payload and every route out of it.
 *
 * The previous body was two hardcoded lines — "Device limit reached" and "Sign in there or contact
 * support" — which discarded `conflictingDeviceName` and `supportEmail`. Telling someone to sign in on a device
 * you decline to name, with no way to act
 * from here, is the definition of a dead end.
 */
@Composable
fun DeviceConflictContent(
    state: BillingState.DeviceConflict,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Host override, else native sign-in by default (rememberPayCraftSignIn).
    DeviceConflictBody(state, onAction, rememberPayCraftSignIn(), modifier)
}

/** [DeviceConflictContent] with the sign-in injected — the seam the state goldens drive. */
@Composable
internal fun DeviceConflictBody(
    state: BillingState.DeviceConflict,
    onAction: (PayCraftPaywallAction) -> Unit,
    signIn: PayCraftSignIn?,
    modifier: Modifier = Modifier,
) {
    ResetStaleSignIn(signIn)
    val colors = PayCraftTheme.colors
    val signInState = signIn?.state ?: SignInState.Idle

    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IdentityHeroTile(
            icon = Icons.Outlined.Devices,
            badge = Icons.Filled.PriorityHigh,
            badgeColor = colors.popularBadge,
        )

        Text(
            text = stringResource(Res.string.paycraft_device_conflict_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        // Naming the other device is the difference between an instruction and a dead end.
        val deviceName = state.conflictingDeviceName ?: stringResource(Res.string.paycraft_device_conflict_other_device)
        val body = stringResource(Res.string.paycraft_device_conflict_body, deviceName)
        Text(
            text = emphasise(body, deviceName, MaterialTheme.colorScheme.onSurface),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_DEVICE_NAME),
        )

        // Account chip — which subscription this is about.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .border(PayCraftTheme.spacing.hairline, MaterialTheme.colorScheme.outline, RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        ) {
            Icon(
                Icons.Outlined.AccountCircle,
                null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = stringResource(Res.string.paycraft_device_conflict_account, state.email),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_EMAIL),
            )
        }

        // ── Gate 1: OAuth — only when the host can actually complete it ────────────────────
        (signInState as? SignInState.WaitingForBrowser)?.let {
            WaitingForBrowserCard(provider = it.provider, onCancel = { signIn?.reset() })
        }
        if (signIn != null && OAuthProvider.GOOGLE in signIn.providers) {
            ProviderButton(
                provider = OAuthProvider.GOOGLE,
                label = stringResource(Res.string.paycraft_device_conflict_gate_oauth_google),
                state = signInState,
                onClick = { signIn.launch(OAuthProvider.GOOGLE) },
                modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE),
            )
        }
        if (signIn != null && OAuthProvider.APPLE in signIn.providers) {
            ProviderButton(
                provider = OAuthProvider.APPLE,
                label = stringResource(Res.string.paycraft_device_conflict_gate_oauth_apple),
                state = signInState,
                onClick = { signIn.launch(OAuthProvider.APPLE) },
                modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_APPLE),
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // The emailed one-time-code gate was REMOVED 2026-09-06. It was the only self-service
        // route for custom-domain emails that cannot be linked to a Google or Apple account; those
        // users now go straight to the support route below. The explainer is unconditional because
        // it is the honest thing to show anyone whose email OAuth cannot serve.
        Text(
            text = stringResource(Res.string.paycraft_device_conflict_gate_support_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        // ── Gate 2: manual transfer via support — ALWAYS present ──────────────────────────
        // Deliberately not conditional. It is the only route that does not depend on the user
        // still controlling the account's email, which is exactly the case where the other two
        // gates fail and someone is locked out of something they paid for.
        TextButton(
            onClick = { onAction(PayCraftPaywallAction.ContactSupportManualTransfer) },
            modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT),
        ) {
            Icon(Icons.Outlined.Email, null, tint = colors.accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(Res.string.paycraft_device_conflict_gate_support, state.supportEmail),
                color = colors.accent,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag(PayCraftTestTags.DEVICE_CONFLICT_SUPPORT_EMAIL),
            )
        }
    }
}

/** [text] with its first [part] in [color] + semibold (the other device's name). */
internal fun emphasise(text: String, part: String, color: Color): AnnotatedString = buildAnnotatedString {
    append(text)
    val at = text.indexOf(part)
    if (at >= 0 && part.isNotEmpty()) {
        addStyle(SpanStyle(color = color, fontWeight = FontWeight.SemiBold), at, at + part.length)
    }
}
