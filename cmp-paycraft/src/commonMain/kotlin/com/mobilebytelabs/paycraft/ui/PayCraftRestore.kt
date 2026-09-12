package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_email_error_empty
import com.mobilebytelabs.paycraft.generated.resources.paycraft_email_error_invalid
import com.mobilebytelabs.paycraft.generated.resources.paycraft_email_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_email_label
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_button
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_cancel
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_checking
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_email_cd
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_failed_message
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_failed_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_oauth_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_or_email
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_sign_in_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_message
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_verifying_identity
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.components.PayCraftPaywallHeader
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private const val TAG_RESTORE_SHEET = "paycraft_restore_sheet"
private const val TAG_RESTORE_EMAIL = "paycraft_restore_email_field"
private const val TAG_RESTORE_BUTTON = "paycraft_restore_button"
private const val TAG_RESTORE_CANCEL = "paycraft_restore_cancel_button"
private const val TAG_RESTORE_SUCCESS = "paycraft_restore_success_message"
private const val TAG_RESTORE_ERROR = "paycraft_restore_error_message"
private const val TAG_RESTORE_GOOGLE = "paycraft_restore_google_button"
private const val TAG_RESTORE_APPLE = "paycraft_restore_apple_button"

// Professional restore surface tuning — consistent with the paywall design language.
private val CtaHeight = 54.dp
private val CtaShape = RoundedCornerShape(14.dp)

/**
 * Modal bottom sheet that lets a user restore their subscription.
 *
 * **Gate 1 (primary)** — Google / Apple sign-in buttons, shown when the host app
 * provides [onGoogleSignInClick] or [onAppleSignInClick] callbacks. The host app
 * triggers the platform OAuth flow and calls [BillingManager.loginWithOAuth] with
 * the resulting ID token; this composable observes [BillingManager.billingState]
 * and reacts automatically.
 *
 * **Gate 2 (fallback)** — Email input + "Restore Purchases" button, always shown
 * below the OAuth section.
 *
 * ```kotlin
 * PayCraftRestore(
 *     visible = showRestore,
 *     onDismiss = { showRestore = false },
 *     onGoogleSignInClick = {
 *         // trigger Google Sign-In on this platform, then:
 *         scope.launch { billingManager.loginWithOAuth(OAuthProvider.GOOGLE, idToken) }
 *     },
 * )
 * ```
 *
 * @param visible Whether the bottom sheet is shown.
 * @param onDismiss Called when the user cancels or restore completes.
 * @param onGoogleSignInClick Provide this to show the "Continue with Google" button.
 *   The host app is responsible for triggering the platform OAuth flow and calling
 *   [BillingManager.loginWithOAuth] after receiving the ID token.
 * @param onAppleSignInClick Provide this to show the "Continue with Apple" button.
 *   Same contract as [onGoogleSignInClick].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftRestore(
    visible: Boolean,
    onDismiss: () -> Unit,
    onGoogleSignInClick: (() -> Unit)? = null,
    onAppleSignInClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    billingManager: BillingManager = koinInject(),
) {
    if (!visible) return

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
                onGoogleSignInClick = onGoogleSignInClick,
                onAppleSignInClick = onAppleSignInClick,
            )
        }
    }
}

/**
 * Stateless restore content. Can be placed in any container (sheet, dialog, screen).
 */
@Composable
fun PayCraftRestoreContent(
    billingManager: BillingManager,
    onCancel: () -> Unit,
    onSuccess: () -> Unit,
    onGoogleSignInClick: (() -> Unit)? = null,
    onAppleSignInClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var email by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }
    var restoreResult by remember { mutableStateOf<RestoreResult?>(null) }

    // Tracks whether the user has tapped any restore CTA in this session.
    // Guards against reacting to the initial Loading state on library init.
    var hasAttemptedRestore by remember { mutableStateOf(false) }

    val billingState by billingManager.billingState.collectAsState()
    val isRestoring = hasAttemptedRestore && billingState is BillingState.Loading

    val scope = rememberCoroutineScope()
    val errorEmpty = stringResource(Res.string.paycraft_email_error_empty)
    val errorInvalid = stringResource(Res.string.paycraft_email_error_invalid)

    // React to billingState changes after a restore was attempted.
    LaunchedEffect(billingState) {
        if (!hasAttemptedRestore) return@LaunchedEffect
        when (billingState) {
            is BillingState.Loading -> { /* spinner already shown via isRestoring */ }
            // A restore never produces a pending payment (nothing is being bought), but the state
            // is reachable if a purchase was mid-flight when the sheet opened. Hold the spinner
            // rather than reporting a restore failure.
            is BillingState.PaymentPending -> { /* purchase still clearing — leave the sheet as-is */ }
            is BillingState.Premium -> {
                restoreResult = RestoreResult.Success
            }
            is BillingState.DeviceConflict -> {
                // Close restore sheet — billingState.DeviceConflict is now active;
                // the host screen observing billingState will show the conflict UI.
                onSuccess()
            }
            is BillingState.Error, is BillingState.Free -> {
                restoreResult = RestoreResult.Failure
            }
            is BillingState.OwnershipVerified -> {
                // Ownership verified — host screen handles transfer dialog.
                onSuccess()
            }
        }
    }

    // Auto-dismiss 1.5s after success
    LaunchedEffect(restoreResult) {
        if (restoreResult == RestoreResult.Success) {
            delay(1_500)
            onSuccess()
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
            .imePadding()
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
            subtitle = if (hasOAuth) {
                stringResource(Res.string.paycraft_restore_oauth_description)
            } else {
                stringResource(Res.string.paycraft_restore_description)
            },
            icon = Icons.Filled.Star,
            heroIconSvg = heroIconSvg,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(spacing.xs))

        // ── Gate 1: OAuth buttons (shown when host app supports it) ──────────
        if (hasOAuth) {
            if (onGoogleSignInClick != null) {
                OutlinedButton(
                    onClick = {
                        hasAttemptedRestore = true
                        restoreResult = null
                        onGoogleSignInClick()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(CtaHeight)
                        .testTag(TAG_RESTORE_GOOGLE),
                    enabled = !isRestoring && restoreResult == null,
                    shape = CtaShape,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = paycraftColors.onSurface,
                    ),
                    border = androidx.compose.foundation.BorderStroke(
                        width = spacing.hairline,
                        color = paycraftColors.outline,
                    ),
                ) {
                    RestoreCtaLabel(
                        loading = isRestoring,
                        loadingText = stringResource(Res.string.paycraft_restore_verifying_identity),
                        idleText = stringResource(Res.string.paycraft_restore_sign_in_google),
                        spinnerColor = paycraftColors.onSurface,
                        spacing = spacing.sm,
                    )
                }
            }

            if (onAppleSignInClick != null) {
                Button(
                    onClick = {
                        hasAttemptedRestore = true
                        restoreResult = null
                        onAppleSignInClick()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(CtaHeight)
                        .testTag(TAG_RESTORE_APPLE),
                    enabled = !isRestoring && restoreResult == null,
                    shape = CtaShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = paycraftColors.onSurface,
                        contentColor = paycraftColors.surface,
                    ),
                ) {
                    RestoreCtaLabel(
                        loading = isRestoring,
                        loadingText = stringResource(Res.string.paycraft_restore_verifying_identity),
                        idleText = stringResource(Res.string.paycraft_restore_sign_in_apple),
                        spinnerColor = paycraftColors.surface,
                        spacing = spacing.sm,
                    )
                }
            }

            // Divider before email fallback
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                HorizontalDivider(modifier = Modifier.weight(1f), color = paycraftColors.divider)
                Text(
                    text = stringResource(Res.string.paycraft_restore_or_email),
                    style = MaterialTheme.typography.labelMedium,
                    color = paycraftColors.onSurfaceVariant,
                )
                HorizontalDivider(modifier = Modifier.weight(1f), color = paycraftColors.divider)
            }
        }

        // ── Gate 2: Email input ───────────────────────────────────────────────
        val emailCd = stringResource(Res.string.paycraft_restore_email_cd)
        OutlinedTextField(
            value = email,
            onValueChange = {
                email = it
                emailError = null
                restoreResult = null
            },
            modifier = Modifier
                .fillMaxWidth()
                .testTag(TAG_RESTORE_EMAIL)
                .semantics { contentDescription = emailCd },
            label = { Text(stringResource(Res.string.paycraft_email_label)) },
            placeholder = { Text(stringResource(Res.string.paycraft_email_hint)) },
            leadingIcon = {
                Icon(Icons.Filled.Email, contentDescription = null)
            },
            isError = emailError != null,
            singleLine = true,
            enabled = !isRestoring,
            shape = CtaShape,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = paycraftColors.accent,
                focusedLeadingIconColor = paycraftColors.accent,
                focusedLabelColor = paycraftColors.accent,
                cursorColor = paycraftColors.accent,
            ),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = {
                triggerEmailRestore(
                    email = email,
                    errorEmpty = errorEmpty,
                    errorInvalid = errorInvalid,
                    onSetEmailError = { emailError = it },
                    onRestore = {
                        hasAttemptedRestore = true
                        restoreResult = null
                        // registerAndLogin sets BillingState.Loading synchronously;
                        // the LaunchedEffect(billingState) above handles the result.
                        billingManager.registerAndLogin(email.trim())
                    },
                )
            }),
            supportingText = when {
                emailError != null -> {
                    {
                        Text(
                            emailError!!,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag(TAG_RESTORE_ERROR),
                        )
                    }
                }
                else -> {
                    {
                        Text(
                            stringResource(Res.string.paycraft_restore_hint),
                            color = paycraftColors.onSurfaceVariant,
                        )
                    }
                }
            },
        )

        // Result card
        when (restoreResult) {
            RestoreResult.Success -> {
                ResultCard(
                    title = stringResource(Res.string.paycraft_restore_success_title),
                    message = stringResource(Res.string.paycraft_restore_success_message),
                    isSuccess = true,
                    testTag = TAG_RESTORE_SUCCESS,
                )
            }
            RestoreResult.Failure -> {
                ResultCard(
                    title = stringResource(Res.string.paycraft_restore_failed_title),
                    message = stringResource(Res.string.paycraft_restore_failed_message),
                    isSuccess = false,
                    testTag = TAG_RESTORE_ERROR,
                )
            }
            null -> {}
        }

        Spacer(modifier = Modifier.height(spacing.xs))

        Button(
            onClick = {
                triggerEmailRestore(
                    email = email,
                    errorEmpty = errorEmpty,
                    errorInvalid = errorInvalid,
                    onSetEmailError = { emailError = it },
                    onRestore = {
                        hasAttemptedRestore = true
                        restoreResult = null
                        billingManager.registerAndLogin(email.trim())
                    },
                )
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(CtaHeight)
                .testTag(TAG_RESTORE_BUTTON),
            enabled = !isRestoring && email.isNotBlank() && restoreResult == null,
            shape = CtaShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = paycraftColors.accent,
                contentColor = paycraftColors.onAccent,
            ),
        ) {
            if (isRestoring && !hasOAuth) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = paycraftColors.onAccent,
                    )
                    Spacer(modifier = Modifier.width(spacing.xs))
                    Text(stringResource(Res.string.paycraft_restore_checking))
                }
            } else {
                Text(
                    stringResource(Res.string.paycraft_restore_button),
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        // Trust line — reassurance the restore is secure (icon-only, locale-safe).
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
                text = stringResource(Res.string.paycraft_restore_hint),
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

/** Shared CTA label — spinner + text while restoring, plain text otherwise. */
@Composable
private fun RestoreCtaLabel(
    loading: Boolean,
    loadingText: String,
    idleText: String,
    spinnerColor: androidx.compose.ui.graphics.Color,
    spacing: androidx.compose.ui.unit.Dp,
) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(18.dp),
            strokeWidth = 2.dp,
            color = spinnerColor,
        )
        Spacer(modifier = Modifier.width(spacing))
        Text(loadingText, fontWeight = FontWeight.Medium)
    } else {
        Text(idleText, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ResultCard(
    title: String,
    message: String,
    isSuccess: Boolean,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    val spacing = PayCraftTheme.spacing
    val bgColor = if (isSuccess) {
        colors.activeBadge.copy(alpha = 0.12f)
    } else {
        colors.errorContainer
    }
    val accentColor = if (isSuccess) colors.activeBadge else colors.onErrorContainer
    val icon: ImageVector = if (isSuccess) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(bgColor, RoundedCornerShape(14.dp))
            .padding(spacing.md)
            .testTag(testTag),
        horizontalArrangement = Arrangement.spacedBy(spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = accentColor,
            modifier = Modifier.size(22.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(spacing.xs / 2)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = accentColor,
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = accentColor.copy(alpha = 0.85f),
            )
        }
    }
}

private fun triggerEmailRestore(
    email: String,
    errorEmpty: String,
    errorInvalid: String,
    onSetEmailError: (String) -> Unit,
    onRestore: () -> Unit,
) {
    val trimmed = email.trim()
    when {
        trimmed.isBlank() -> onSetEmailError(errorEmpty)
        !trimmed.contains("@") || !trimmed.contains(".") -> onSetEmailError(errorInvalid)
        else -> onRestore()
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
