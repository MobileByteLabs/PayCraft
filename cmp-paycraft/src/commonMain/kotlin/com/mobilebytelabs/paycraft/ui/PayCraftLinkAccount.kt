package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_cancelled
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_done
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_failed_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_not_now
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_failed_title
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.ui.components.IdentityHeroTile
import com.mobilebytelabs.paycraft.ui.components.IdentityNote
import com.mobilebytelabs.paycraft.ui.components.IdentityResultCard
import com.mobilebytelabs.paycraft.ui.components.PayCraftSignIn
import com.mobilebytelabs.paycraft.ui.components.ProviderButton
import com.mobilebytelabs.paycraft.ui.components.ResetStaleSignIn
import com.mobilebytelabs.paycraft.ui.components.WaitingForBrowserCard
import com.mobilebytelabs.paycraft.ui.components.rememberPayCraftSignIn
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

/**
 * Wraps a paywall so a STORE purchase made without an identity is followed — once — by the
 * optional, full-screen [PayCraftLinkAccountScreen] before [onFinished] (PLAN-paycraft-native-
 * identity D4). Never shown before a purchase, never blocking it (Apple 5.1.1).
 *
 * "Just purchased" is premium now but not on entry: a subscriber who opens the paywall to look at
 * plans is not prompted. A purchase that already carries an identity (an email from web checkout or
 * an earlier sign-in) is linked already, so the prompt is skipped.
 *
 * @param onFinished called once the purchase is complete and the prompt (if any) is done.
 */
@Composable
internal fun PostPurchaseLinkGate(onFinished: () -> Unit, paywall: @Composable () -> Unit) {
    val billing = koinInject<BillingManager>()
    val store = koinInject<PayCraftStore>()
    val isPremium by billing.isPremium.collectAsState()
    val email by billing.userEmail.collectAsState()
    val premiumOnEntry = remember { isPremium }
    var linking by remember { mutableStateOf(false) }

    LaunchedEffect(isPremium) {
        if (!isPremium || premiumOnEntry) return@LaunchedEffect
        if (email == null && !store.isLinkPromptShown()) {
            store.markLinkPromptShown()
            linking = true
        } else {
            onFinished()
        }
    }

    if (linking) PayCraftLinkAccountScreen(onDone = onFinished) else paywall()
}

/**
 * "Keep your subscription on all your devices" — native Apple / Google sign-in, always skippable.
 *
 * Signing in identifies the buyer (the billing manager observes PayCraft's session), which re-links
 * the store purchase to that account so it restores on the other platform. Renders the D6 sign-in
 * state (PLAN-paycraft-verified-identity): progress on the tapped provider, a browser-waiting card
 * that can be cancelled, a quiet note on cancel, an error card on failure (the buttons are the
 * retry). The screen closes itself shortly after the link lands, showing which account it went to.
 *
 * [signIn] / [linkedEmail] are injectable so every state can be rendered without Koin or a network.
 */
@Composable
internal fun PayCraftLinkAccountScreen(
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    signIn: PayCraftSignIn? = rememberPayCraftSignIn(),
    linkedEmail: String? = koinInject<BillingManager>().userEmail.collectAsState().value,
) {
    ResetStaleSignIn(signIn)
    val state = signIn?.state ?: SignInState.Idle
    val linked = linkedEmail ?: (state as? SignInState.Linked)?.email
    val colors = PayCraftTheme.colors

    LaunchedEffect(linked) {
        if (linked != null) {
            delay(1_500)
            onDone()
        }
    }

    Surface(
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier.fillMaxSize().testTag(PayCraftTestTags.LINK_ACCOUNT_SCREEN),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Explanation + status scroll; the actions stay pinned to the bottom (Stitch link-*).
            Column(
                modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(24.dp))
                val (badge, badgeColor) = when {
                    linked != null -> Icons.Filled.Check to colors.activeBadge
                    state is SignInState.Failed ->
                        Icons.Filled.PriorityHigh to
                            MaterialTheme.colorScheme.onErrorContainer
                    else -> Icons.Filled.Sync to colors.accent
                }
                IdentityHeroTile(icon = Icons.Outlined.Devices, badge = badge, badgeColor = badgeColor)
                Text(
                    text = stringResource(Res.string.paycraft_link_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
                if (linked != null) {
                    IdentityResultCard(
                        title = stringResource(Res.string.paycraft_link_done, linked),
                        message = null,
                        isSuccess = true,
                        testTag = PayCraftTestTags.LINK_ACCOUNT_DONE,
                    )
                    return@Column
                }
                Text(
                    text = stringResource(Res.string.paycraft_link_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.VerifiedUser, null, tint = colors.accent, modifier = Modifier.size(16.dp))
                    Text(
                        text = stringResource(Res.string.paycraft_link_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }

                when (state) {
                    is SignInState.WaitingForBrowser ->
                        WaitingForBrowserCard(provider = state.provider, onCancel = { signIn?.reset() })
                    is SignInState.Failed -> IdentityResultCard(
                        title = stringResource(Res.string.paycraft_sign_in_failed_title),
                        message = stringResource(Res.string.paycraft_link_failed_body),
                        isSuccess = false,
                        testTag = PayCraftTestTags.SIGN_IN_FAILED,
                    )
                    is SignInState.Cancelled -> IdentityNote(
                        text = stringResource(Res.string.paycraft_link_cancelled),
                        testTag = PayCraftTestTags.SIGN_IN_CANCELLED,
                    )
                    else -> Unit
                }
            }

            if (linked != null) return@Column
            Spacer(Modifier.height(16.dp))
            if (signIn != null && OAuthProvider.APPLE in signIn.providers) {
                ProviderButton(
                    provider = OAuthProvider.APPLE,
                    label = stringResource(Res.string.paycraft_device_conflict_gate_oauth_apple),
                    state = state,
                    onClick = { signIn.launch(OAuthProvider.APPLE) },
                    modifier = Modifier.testTag(PayCraftTestTags.LINK_ACCOUNT_APPLE),
                )
                Spacer(Modifier.height(12.dp))
            }
            if (signIn != null && OAuthProvider.GOOGLE in signIn.providers) {
                ProviderButton(
                    provider = OAuthProvider.GOOGLE,
                    label = stringResource(Res.string.paycraft_device_conflict_gate_oauth_google),
                    state = state,
                    onClick = { signIn.launch(OAuthProvider.GOOGLE) },
                    modifier = Modifier.testTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE),
                )
                Spacer(Modifier.height(8.dp))
            }
            TextButton(
                onClick = onDone,
                modifier = Modifier.fillMaxWidth().height(48.dp).testTag(PayCraftTestTags.LINK_ACCOUNT_NOT_NOW),
            ) {
                Text(
                    stringResource(Res.string.paycraft_link_not_now),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
