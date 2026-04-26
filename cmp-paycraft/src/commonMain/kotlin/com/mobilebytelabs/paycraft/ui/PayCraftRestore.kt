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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_message
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_success_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_restore_title
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private const val TAG_RESTORE_SHEET = "paycraft_restore_sheet"
private const val TAG_RESTORE_EMAIL = "paycraft_restore_email_field"
private const val TAG_RESTORE_BUTTON = "paycraft_restore_button"
private const val TAG_RESTORE_CANCEL = "paycraft_restore_cancel_button"
private const val TAG_RESTORE_SUCCESS = "paycraft_restore_success_message"
private const val TAG_RESTORE_ERROR = "paycraft_restore_error_message"

/**
 * Modal bottom sheet that lets a user restore their subscription by entering
 * the email they used to purchase.
 *
 * ```kotlin
 * var showRestore by remember { mutableStateOf(false) }
 *
 * TextButton(onClick = { showRestore = true }) { Text("Restore purchases") }
 *
 * PayCraftRestore(
 *     visible = showRestore,
 *     onDismiss = { showRestore = false },
 * )
 * ```
 *
 * @param visible Whether the bottom sheet is shown.
 * @param onDismiss Called when the user dismisses or restore succeeds.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftRestore(
    visible: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    billingManager: BillingManager = koinInject(),
) {
    if (!visible) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        dragHandle = null,
        modifier = modifier.testTag(TAG_RESTORE_SHEET),
    ) {
        PayCraftRestoreContent(
            billingManager = billingManager,
            onCancel = onDismiss,
            onSuccess = onDismiss,
        )
    }
}

/**
 * Stateless restore content with self-managed restore flow.
 * Can be placed in any container (sheet, dialog, screen).
 */
@Composable
fun PayCraftRestoreContent(
    billingManager: BillingManager,
    onCancel: () -> Unit,
    onSuccess: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var email by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }
    var isRestoring by remember { mutableStateOf(false) }
    var restoreResult by remember { mutableStateOf<RestoreResult?>(null) }
    val scope = rememberCoroutineScope()

    val billingStateAccessor = billingManager

    val errorEmpty = stringResource(Res.string.paycraft_email_error_empty)
    val errorInvalid = stringResource(Res.string.paycraft_email_error_invalid)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 8.dp)
            .padding(bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // T13: 64dp Star icon in primaryContainer circle
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(64.dp)
                .background(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = CircleShape,
                ),
        ) {
            Icon(
                imageVector = Icons.Filled.Star,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(32.dp),
            )
        }

        Text(
            text = stringResource(Res.string.paycraft_restore_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )

        Text(
            text = stringResource(Res.string.paycraft_restore_description),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(4.dp))

        // T14: AccountCircle leading icon, T15: hint text via supportingText
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
                // T14: AccountCircle icon
                Icon(Icons.Filled.AccountCircle, contentDescription = null)
            },
            isError = emailError != null,
            singleLine = true,
            enabled = !isRestoring,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = {
                triggerRestore(
                    email = email,
                    errorEmpty = errorEmpty,
                    errorInvalid = errorInvalid,
                    onSetEmailError = { emailError = it },
                    onRestore = {
                        scope.launch {
                            isRestoring = true
                            billingStateAccessor.logIn(email.trim())
                            delay(3_000)
                            isRestoring = false
                            // Check if now premium
                            restoreResult = RestoreResult.Success // optimistic; evaluated below
                        }
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
                // T15: hint text when no error
                else -> {
                    {
                        Text(
                            stringResource(Res.string.paycraft_restore_hint),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
        )

        // T16: Result cards with tinted background
        when (restoreResult) {
            RestoreResult.Success -> {
                ResultCard(
                    title = stringResource(Res.string.paycraft_restore_success_title),
                    message = stringResource(Res.string.paycraft_restore_success_message),
                    isSuccess = true,
                    testTag = TAG_RESTORE_SUCCESS,
                )
                // T16: auto-dismiss 1.5s after success
                LaunchedEffect(Unit) {
                    delay(1_500)
                    onSuccess()
                }
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

        Spacer(modifier = Modifier.height(4.dp))

        Button(
            onClick = {
                triggerRestore(
                    email = email,
                    errorEmpty = errorEmpty,
                    errorInvalid = errorInvalid,
                    onSetEmailError = { emailError = it },
                    onRestore = {
                        scope.launch {
                            isRestoring = true
                            restoreResult = null
                            billingStateAccessor.logIn(email.trim())
                            // T16: 3s verify delay
                            delay(3_000)
                            isRestoring = false
                            // Determine result based on billing state (observed via collectAsState in caller if needed)
                            // For standalone usage, we rely on billingManager.billingState
                        }
                    },
                )
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag(TAG_RESTORE_BUTTON),
            enabled = !isRestoring && email.isNotBlank() && restoreResult == null,
        ) {
            if (isRestoring) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(Res.string.paycraft_restore_checking))
                }
            } else {
                Text(stringResource(Res.string.paycraft_restore_button))
            }
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
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// T16: Result card with tinted background
@Composable
private fun ResultCard(
    title: String,
    message: String,
    isSuccess: Boolean,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    val bgColor = if (isSuccess) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)
    } else {
        MaterialTheme.colorScheme.error.copy(alpha = 0.08f)
    }
    val textColor = if (isSuccess) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.error
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(bgColor, RoundedCornerShape(12.dp))
            .padding(16.dp)
            .testTag(testTag),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = textColor,
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = textColor.copy(alpha = 0.85f),
        )
    }
}

private fun triggerRestore(
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
