/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Building blocks shared by the account-link surfaces (sdk-account-link: restore sheet, post-purchase
 * link screen, device conflict). Layout follows the Stitch designs; colours come from PayCraftTheme,
 * except the two provider buttons, which follow Apple's and Google's own button rules.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ic_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_ic_google_g
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_provider_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_verifying_identity
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_opening
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_waiting_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_waiting_cancel
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_waiting_title
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource

internal val IdentityCtaHeight = 54.dp
internal val IdentityCtaShape = RoundedCornerShape(14.dp)
private val CardShape = RoundedCornerShape(14.dp)

@Composable
internal fun providerName(provider: OAuthProvider): String = stringResource(
    if (provider == OAuthProvider.APPLE) Res.string.paycraft_provider_apple else Res.string.paycraft_provider_google,
)

/**
 * A provider sign-in button, drawn the way each provider requires: Apple is a high-contrast FILLED
 * button with the Apple logo (white on a dark theme, black on a light one — the inverse of the
 * surface); Google is OUTLINED with the multicolour "G". While [state] is running for this
 * [provider] the logo becomes a spinner and the label says where the attempt is; while it runs
 * for the other provider the button is disabled.
 */
@Composable
internal fun ProviderButton(
    provider: OAuthProvider,
    label: String,
    state: SignInState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = PayCraftTheme.colors
    val busy = state.busyProvider == provider
    val canClick = enabled && state.busyProvider == null
    val text = when {
        !busy -> label
        state is SignInState.Launching -> stringResource(Res.string.paycraft_sign_in_opening, providerName(provider))
        state is SignInState.Verifying -> stringResource(Res.string.paycraft_restore_verifying_identity)
        else -> label
    }
    // The busy button is disabled too (no double launch) but must not LOOK disabled.
    val dim = if (canClick || busy) 1f else 0.38f
    val sized = modifier.fillMaxWidth().height(IdentityCtaHeight)
    val content: @Composable () -> Unit = {
        ProviderLabel(provider = provider, text = text, busy = busy, dim = dim)
    }
    if (provider == OAuthProvider.APPLE) {
        // Apple allows black or white only: white on a dark surface, black on a light one.
        val darkSurface = MaterialTheme.colorScheme.surface.luminance() < 0.5f
        val container = if (darkSurface) Color.White else Color.Black
        val onContainer = if (darkSurface) Color.Black else Color.White
        Button(
            onClick = onClick,
            enabled = canClick,
            modifier = sized,
            shape = IdentityCtaShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = container,
                contentColor = onContainer,
                disabledContainerColor = container.copy(alpha = if (busy) 1f else 0.38f),
                disabledContentColor = onContainer,
            ),
        ) { content() }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = canClick,
            modifier = sized,
            shape = IdentityCtaShape,
            border = BorderStroke(PayCraftTheme.spacing.hairline, MaterialTheme.colorScheme.outline.copy(alpha = dim)),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurface,
                disabledContentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) { content() }
    }
}

@Composable
private fun ProviderLabel(provider: OAuthProvider, text: String, busy: Boolean, dim: Float) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = Modifier.alpha(dim),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = androidx.compose.material3.LocalContentColor.current,
            )
        } else if (provider == OAuthProvider.APPLE) {
            // Single-colour mark: takes the button's content colour.
            Icon(painterResource(Res.drawable.paycraft_ic_apple), contentDescription = null, Modifier.size(20.dp))
        } else {
            // The "G" keeps its four brand colours — never tinted.
            Image(painterResource(Res.drawable.paycraft_ic_google_g), contentDescription = null, Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    }
}

/** Rounded-square hero tile with an optional status badge on its corner (link + conflict screens). */
@Composable
internal fun IdentityHeroTile(
    icon: ImageVector,
    badge: ImageVector?,
    badgeColor: Color,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    Box(modifier = modifier.size(72.dp)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(64.dp)
                .align(Alignment.Center)
                .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(18.dp))
                .border(
                    PayCraftTheme.spacing.hairline,
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.25f),
                    RoundedCornerShape(18.dp),
                ),
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp),
            )
        }
        if (badge != null) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = (-2).dp, y = (-2).dp)
                    .size(24.dp)
                    .background(MaterialTheme.colorScheme.surface, CircleShape)
                    .padding(2.dp)
                    .background(badgeColor, CircleShape),
            ) {
                Icon(badge, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
            }
        }
    }
}

/**
 * "Finish signing in with Apple" — the browser flow is out of the app. Spinner, what to do, and a
 * way out ([onCancel] → [PayCraftSignIn.reset]) so a user who closed the browser is never stuck.
 */
@Composable
internal fun WaitingForBrowserCard(provider: OAuthProvider, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    val colors = PayCraftTheme.colors
    IdentityProgressCard(
        title = stringResource(Res.string.paycraft_sign_in_waiting_title, providerName(provider)),
        body = stringResource(Res.string.paycraft_sign_in_waiting_body),
        testTag = PayCraftTestTags.SIGN_IN_WAITING,
        modifier = modifier,
    ) {
        HorizontalDivider(Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
        TextButton(
            onClick = onCancel,
            modifier = Modifier.align(Alignment.End).testTag(PayCraftTestTags.SIGN_IN_WAITING_CANCEL),
        ) { Text(stringResource(Res.string.paycraft_sign_in_waiting_cancel), color = colors.accent) }
    }
}

/** Spinner + title + body on a soft accent card: something is running (browser sign-in, restore lookup). */
@Composable
internal fun IdentityProgressCard(
    title: String,
    body: String,
    testTag: String,
    modifier: Modifier = Modifier,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = PayCraftTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f), CardShape)
            .border(PayCraftTheme.spacing.hairline, colors.accent.copy(alpha = 0.3f), CardShape)
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = if (footer != null) 4.dp else 16.dp)
            .testTag(testTag),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
            CircularProgressIndicator(
                modifier = Modifier.padding(top = 2.dp).size(22.dp),
                strokeWidth = 2.5.dp,
                color = colors.accent,
            )
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        footer?.invoke(this)
    }
}

/** Softly rounded outcome row: success on activeBadge @12% with a check, error on errorContainer. */
@Composable
internal fun IdentityResultCard(
    title: String,
    message: String?,
    isSuccess: Boolean,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    val accent = if (isSuccess) colors.activeBadge else MaterialTheme.colorScheme.onErrorContainer
    val bg = if (isSuccess) colors.activeBadge.copy(alpha = 0.12f) else MaterialTheme.colorScheme.errorContainer
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(bg, CardShape)
            .border(PayCraftTheme.spacing.hairline, accent.copy(alpha = 0.3f), CardShape)
            .padding(16.dp)
            .testTag(testTag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = if (isSuccess) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(22.dp),
        )
        // TEXT never takes the accent on success: a host's badge colour (cappy: amber) on its own 12% tint
        // fails contrast — device capture 2026-11-01 read amber-on-cream. Icon + border carry the colour;
        // words use the surface pair, readable on any host palette. Error keeps its designed container pair.
        val titleColor = if (isSuccess) MaterialTheme.colorScheme.onSurface else accent
        val bodyColor = if (isSuccess) MaterialTheme.colorScheme.onSurfaceVariant else accent.copy(alpha = 0.85f)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = titleColor,
            )
            if (message != null) {
                Text(message, style = MaterialTheme.typography.bodySmall, color = bodyColor)
            }
        }
    }
}

/** Quiet one-line note (sign-in cancelled) — information, not an error. */
@Composable
internal fun IdentityNote(text: String, testTag: String, modifier: Modifier = Modifier) {
    val colors = PayCraftTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f), CardShape)
            .border(PayCraftTheme.spacing.hairline, MaterialTheme.colorScheme.outline, CardShape)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag(testTag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Info,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}
