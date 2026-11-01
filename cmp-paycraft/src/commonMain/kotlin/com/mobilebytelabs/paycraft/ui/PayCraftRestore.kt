package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_cancel
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_checking
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_checking_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_failed_message
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_failed_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_network_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_network_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_privacy
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_retry
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_cancelled
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_failed_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_signed_in_as
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_message
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_sign_in_failed_title
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.ui.components.IdentityCtaHeight
import com.mobilebytelabs.paycraft.ui.components.IdentityCtaShape
import com.mobilebytelabs.paycraft.ui.components.IdentityNote
import com.mobilebytelabs.paycraft.ui.components.IdentityProgressCard
import com.mobilebytelabs.paycraft.ui.components.IdentityResultCard
import com.mobilebytelabs.paycraft.ui.components.LocalPayCraftOAuthHandler
import com.mobilebytelabs.paycraft.ui.components.PayCraftPaywallHeader
import com.mobilebytelabs.paycraft.ui.components.PayCraftSignIn
import com.mobilebytelabs.paycraft.ui.components.ProviderButton
import com.mobilebytelabs.paycraft.ui.components.ResetStaleSignIn
import com.mobilebytelabs.paycraft.ui.components.WaitingForBrowserCard
import com.mobilebytelabs.paycraft.ui.components.busyProvider
import com.mobilebytelabs.paycraft.ui.components.rememberPayCraftSignIn
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private const val TAG_RESTORE_SHEET = "paycraft_restore_sheet"
private const val TAG_RESTORE_CANCEL = "paycraft_restore_cancel_button"
private const val TAG_RESTORE_SUCCESS = "paycraft_restore_success_message"
private const val TAG_RESTORE_ERROR = "paycraft_restore_error_message"
private const val TAG_RESTORE_NETWORK_ERROR = "paycraft_restore_network_error"
private const val TAG_RESTORE_CHECKING = "paycraft_restore_checking"
private const val TAG_RESTORE_RETRY = "paycraft_restore_retry_button"
private const val TAG_RESTORE_GOOGLE = "paycraft_restore_google_button"
private const val TAG_RESTORE_APPLE = "paycraft_restore_apple_button"

/** What the last restore lookup concluded. Free and Error are distinct BillingStates, so no new signal. */
private enum class RestoreOutcome { Restored, NotFound, Failed }

/**
 * Modal bottom sheet that lets a user restore their subscription.
 *
 * Store first (no account), then Google / Apple sign-in — shown when the SDK or the host can complete
 * one ([rememberPayCraftSignIn]). There is NO typed-email path: a typed address is an unverified claim
 * (anyone can name someone else's email), a sign-in is a provider-signed proof (removed 2026-11-01).
 *
 * ## Internal: the SDK presents this, a host does not place it
 *
 * Each SDK surface that offers restore owns the sheet through [rememberRestorePresenter]: the
 * banner, the premium banner and [PayCraftPlanSection]. A host that wants a restore
 * affordance uses one of those, which is the same answer as for the paywall.
 *
 * Platform OAuth goes through [LocalPayCraftOAuthHandler] (shared with [DeviceConflictContent]),
 * provided once around the app.
 *
 * @param visible Whether the bottom sheet is shown.
 * @param onDismiss Called when the user cancels or restore completes.
 */
@Composable
internal fun PayCraftRestore(visible: Boolean, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    // The visibility check comes BEFORE anything is resolved from Koin, and NOTHING here is a
    // `koinInject()` default, because a DEFAULT ARGUMENT IS EVALUATED AT THE CALL SITE — before this
    // function body runs. With `billingManager: BillingManager = koinInject()` the inject happened
    // even when `visible` was false, so merely HAVING a hidden restore sheet in a composable
    // required a started Koin graph. That broke every @Preview and Roborazzi screenshot of any host
    // screen containing one: cappy's settings previews all failed with "KoinApplication has not been
    // started", pointing at a sheet that was not even shown.
    //
    // The manager was a nullable PARAMETER so a preview could pass one; it is now resolved below
    // instead, because an early `return` already solves the preview problem and a host choosing the
    // entitlement source never was a real use case. Internal tests drive PayCraftRestoreContent,
    // which still takes one.
    if (!visible) return

    PayCraftRestoreSheet(
        onDismiss = onDismiss,
        modifier = modifier,
        billingManager = koinInject(),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PayCraftRestoreSheet(onDismiss: () -> Unit, modifier: Modifier, billingManager: BillingManager) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Re-apply the dashboard brand theme at the sheet boundary. Material3
    // ModalBottomSheet hosts its content in a separate window layer that does NOT
    // inherit the PayCraftThemeProvider wrapping the paywall, so without this the
    // restore sheet renders in the host app's MaterialTheme (e.g. reels-downloader's
    // blue) instead of PayCraft's configured brand. Mirrors PayCraftPaywallSheet.
    val liveConfig = PayCraft.suiteConfigFlow.collectAsState().value
    PayCraftThemeProvider(config = liveConfig) {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = sheetState,
            dragHandle = null,
            containerColor = PayCraftTheme.colors.surface,
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            modifier = modifier.testTag(TAG_RESTORE_SHEET),
        ) {
            PayCraftRestoreContent(
                billingManager = billingManager,
                onCancel = onDismiss,
                onSuccess = onDismiss,
            )
        }
    }
}

/**
 * Stateless restore content. Can be placed in any container (sheet, dialog, screen).
 *
 * The OAuth buttons come from [LocalPayCraftOAuthHandler] rather than from parameters — one
 * mechanism for "ask the host to run platform sign-in", shared with [DeviceConflictContent].
 */
@Composable
internal fun PayCraftRestoreContent(
    billingManager: BillingManager,
    onCancel: () -> Unit,
    onSuccess: () -> Unit,
    modifier: Modifier = Modifier,
    // Host override, else NATIVE sign-in by default — Apple only where it can complete (iOS, or an
    // Apple Services ID elsewhere). See rememberPayCraftSignIn. A parameter so tests drive each D6 state.
    signIn: PayCraftSignIn? = rememberPayCraftSignIn(),
) {
    ResetStaleSignIn(signIn)
    val signInState = signIn?.state ?: SignInState.Idle
    val onGoogleSignInClick: (() -> Unit)? =
        signIn?.takeIf { OAuthProvider.GOOGLE in it.providers }?.let { s -> { s.launch(OAuthProvider.GOOGLE) } }
    val onAppleSignInClick: (() -> Unit)? =
        signIn?.takeIf { OAuthProvider.APPLE in it.providers }?.let { s -> { s.launch(OAuthProvider.APPLE) } }

    var outcome by remember { mutableStateOf<RestoreOutcome?>(null) }

    // Tracks whether the user has started a sign-in in this session.
    // Guards against reacting to the initial Loading state on library init.
    var hasAttemptedRestore by remember { mutableStateOf(false) }
    // "Try again" re-queries the store before billing state moves; spin for that window too.
    var retrying by remember { mutableStateOf(false) }

    val billingState by billingManager.billingState.collectAsState()
    val userEmail by billingManager.userEmail.collectAsState()
    // The account the lookup ran for — named on the restored / not-found cards.
    val account = (signInState as? SignInState.Linked)?.email ?: userEmail
    val signInBusy = signInState.busyProvider != null

    // A verified sign-in hands its email to billing, which re-queries the store + server: the
    // "Checking your purchases…" card stands where the CTAs were until that lands.
    val isRestoring = retrying || (hasAttemptedRestore && !signInBusy && billingState is BillingState.Loading)
    val waiting = signInState as? SignInState.WaitingForBrowser

    val scope = rememberCoroutineScope()

    // React to billingState changes after a restore was attempted.
    LaunchedEffect(billingState) {
        if (!hasAttemptedRestore) return@LaunchedEffect
        when (billingState) {
            is BillingState.Loading -> { /* status card shown via isRestoring */ }
            // A restore never produces a pending payment (nothing is being bought), but the state
            // is reachable if a purchase was mid-flight when the sheet opened. Hold the sheet as-is
            // rather than reporting a restore failure.
            is BillingState.PaymentPending -> {}
            is BillingState.Premium -> outcome = RestoreOutcome.Restored
            // Close restore sheet — the host screen observing billingState shows the conflict /
            // transfer UI.
            is BillingState.DeviceConflict, is BillingState.OwnershipVerified -> onSuccess()
            // The server answered: no subscription for this account.
            is BillingState.Free -> outcome = RestoreOutcome.NotFound
            // The lookup itself failed (network / server) — retryable, not "nothing found".
            is BillingState.Error -> outcome = RestoreOutcome.Failed
        }
    }

    // STORE FIRST. A Google Play / App Store buyer restores through their store account — no
    // sign-in (Apple requires that a Restore tap works without an account). Returns false (a
    // no-op) where there is no native store; the sign-in buttons are then the way to restore.
    LaunchedEffect(Unit) {
        if (billingManager.restoreStorePurchases()) outcome = RestoreOutcome.Restored
    }

    // Auto-dismiss 1.5s after success
    LaunchedEffect(outcome) {
        if (outcome == RestoreOutcome.Restored) {
            delay(1_500)
            onSuccess()
        }
    }

    val retry: () -> Unit = {
        outcome = null
        retrying = true
        scope.launch {
            if (billingManager.restoreStorePurchases()) {
                outcome = RestoreOutcome.Restored
            } else {
                // Re-check the server for the signed-in account (Loading → result, observed above).
                billingManager.refreshStatus(force = true)
                // With nothing to re-check, refreshStatus leaves an Error untouched — show it again.
                if (billingManager.billingState.value is BillingState.Error) outcome = RestoreOutcome.Failed
            }
            retrying = false
        }
    }

    val startSignIn: (() -> Unit) -> () -> Unit = { launch ->
        {
            hasAttemptedRestore = true
            outcome = null
            launch()
        }
    }

    val hasOAuth = onGoogleSignInClick != null || onAppleSignInClick != null

    val spacing = PayCraftTheme.spacing
    val paycraftColors = PayCraftTheme.colors

    // Tenant branding mark (dashboard-configured) for the hero, falling back to a
    // premium star so the restore surface matches the paywall's branded header.
    val heroIconSvg = PayCraft.suiteConfigFlow.collectAsState().value?.paywall?.heroIconSvg

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = spacing.lg)
            .padding(top = spacing.sm, bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Grabber — subtle drag affordance (the sheet uses dragHandle = null).
        Box(
            modifier = Modifier
                .padding(bottom = spacing.xs)
                .size(width = 36.dp, height = 4.dp)
                .background(
                    color = paycraftColors.onSurfaceVariant.copy(alpha = 0.28f),
                    shape = RoundedCornerShape(2.dp),
                ),
        )

        // Branded hero header — same component + language as the paywall.
        PayCraftPaywallHeader(
            title = stringResource(Res.string.paycraft_restore_title),
            subtitle = stringResource(Res.string.paycraft_restore_description),
            icon = Icons.Filled.Star,
            heroIconSvg = heroIconSvg,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(spacing.xs))

        if (signInState is SignInState.Failed && outcome == null) {
            IdentityResultCard(
                title = stringResource(Res.string.paycraft_sign_in_failed_title),
                message = stringResource(Res.string.paycraft_restore_sign_in_failed_body),
                isSuccess = false,
                testTag = PayCraftTestTags.SIGN_IN_FAILED,
            )
        }
        if (waiting != null) {
            WaitingForBrowserCard(provider = waiting.provider, onCancel = { signIn?.reset() })
        }

        when (outcome) {
            RestoreOutcome.Restored -> {
                IdentityResultCard(
                    title = stringResource(Res.string.paycraft_restore_success_title),
                    message = stringResource(Res.string.paycraft_restore_success_message),
                    isSuccess = true,
                    testTag = TAG_RESTORE_SUCCESS,
                )
                if (account != null) SignedInAs(account)
            }
            RestoreOutcome.NotFound -> IdentityResultCard(
                title = stringResource(Res.string.paycraft_restore_failed_title),
                message = account?.let { stringResource(Res.string.paycraft_restore_failed_message, it) },
                isSuccess = false,
                testTag = TAG_RESTORE_ERROR,
            )
            RestoreOutcome.Failed -> {
                IdentityResultCard(
                    title = stringResource(Res.string.paycraft_restore_network_title),
                    message = stringResource(Res.string.paycraft_restore_network_body),
                    isSuccess = false,
                    testTag = TAG_RESTORE_NETWORK_ERROR,
                )
                Button(
                    onClick = retry,
                    modifier = Modifier.fillMaxWidth().height(IdentityCtaHeight).testTag(TAG_RESTORE_RETRY),
                    shape = IdentityCtaShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = paycraftColors.accent,
                        contentColor = paycraftColors.onAccent,
                    ),
                ) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(spacing.sm))
                    Text(stringResource(Res.string.paycraft_restore_retry), fontWeight = FontWeight.SemiBold)
                }
                if (hasOAuth) HorizontalDivider(color = paycraftColors.divider)
            }
            null -> {}
        }

        if (isRestoring) {
            IdentityProgressCard(
                title = stringResource(Res.string.paycraft_restore_checking),
                body = stringResource(Res.string.paycraft_restore_checking_body),
                testTag = TAG_RESTORE_CHECKING,
            )
        } else if (outcome != RestoreOutcome.Restored) {
            // Provider CTAs: the only way to restore beyond the store. Re-enabled after not-found /
            // error / cancel / failure so the buyer can try another account.
            if (onGoogleSignInClick != null) {
                ProviderButton(
                    provider = OAuthProvider.GOOGLE,
                    label = stringResource(Res.string.paycraft_restore_sign_in_google),
                    state = signInState,
                    onClick = startSignIn(onGoogleSignInClick),
                    modifier = Modifier.testTag(TAG_RESTORE_GOOGLE),
                )
            }
            if (onAppleSignInClick != null) {
                ProviderButton(
                    provider = OAuthProvider.APPLE,
                    label = stringResource(Res.string.paycraft_restore_sign_in_apple),
                    state = signInState,
                    onClick = startSignIn(onAppleSignInClick),
                    modifier = Modifier.testTag(TAG_RESTORE_APPLE),
                )
            }
            if (signInState is SignInState.Cancelled) {
                IdentityNote(
                    text = stringResource(Res.string.paycraft_restore_sign_in_cancelled),
                    testTag = PayCraftTestTags.SIGN_IN_CANCELLED,
                )
            }
        }

        // Trust line — what happens to the account the buyer signs in with.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.xs),
        ) {
            Icon(
                imageVector = Icons.Filled.Lock,
                contentDescription = null,
                tint = paycraftColors.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = stringResource(Res.string.paycraft_restore_privacy),
                style = MaterialTheme.typography.labelSmall,
                color = paycraftColors.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        TextButton(
            onClick = onCancel,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .testTag(TAG_RESTORE_CANCEL),
        ) {
            Text(
                text = stringResource(Res.string.paycraft_restore_cancel),
                color = paycraftColors.onSurfaceVariant,
            )
        }
    }
}

/** "Signed in as {email}" caption under the restored card. */
@Composable
private fun SignedInAs(email: String) {
    val colors = PayCraftTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PayCraftTheme.spacing.xs),
    ) {
        Icon(
            Icons.Outlined.Person,
            contentDescription = null,
            tint = colors.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Text(
            stringResource(Res.string.paycraft_restore_signed_in_as, email),
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant,
        )
    }
}

/**
 * Paywall-integrated restore surface — the single-composable variant that hosts
 * pick when they want the paywall AND the modal restore sheet in one drop-in
 * (typically a "welcome back" flow that opens the paywall on cold start and
 * silently exposes the restore modal via the paywall's legal-footer RESTORE link).
 *
 * Delegates through [PayCraftPaywallComposable] so the paywall renders through the
 * single v2 template path (Phase-2 clean-SDK consolidation, AC-4). The restore
 * modal itself is rendered by [PayCraftPaywallComposable] internally — no separate
 * [PayCraftRestore] call is needed at the host layer.
 *
 * @param onDismiss Called when the paywall dismisses (close button, sheet dismiss,
 *                  or a successful restore that navigates the user away).
 * @param modifier  Optional modifier applied to the root surface.
 */
@Composable
fun PayCraftPaywallWithRestore(onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    PayCraftPaywallComposable(
        onDismiss = onDismiss,
        displayMode = DisplayMode.FullScreen,
        modifier = modifier,
    )
}
