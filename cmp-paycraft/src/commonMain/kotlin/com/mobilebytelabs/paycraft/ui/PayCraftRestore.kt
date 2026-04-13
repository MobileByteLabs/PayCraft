package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.mobilebytelabs.paycraft.model.BillingState
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
 * Calling [PayCraftRestore] is the simplest way to integrate the restore flow:
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
 * For full-screen or dialog variants, use [PayCraftRestoreContent] directly.
 *
 * @param visible Whether the bottom sheet is shown.
 * @param onDismiss Called when the user dismisses the sheet or restore succeeds.
 * @param billingManager Override for testing; resolved from Koin by default.
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
    val billingState by billingManager.billingState.collectAsState()

    var email by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }
    val isChecking = billingState is BillingState.Loading

    // Auto-dismiss on successful restore
    LaunchedEffect(billingState) {
        if (billingState is BillingState.Premium) {
            onDismiss()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = modifier.testTag(TAG_RESTORE_SHEET),
    ) {
        PayCraftRestoreContent(
            email = email,
            emailError = emailError,
            isChecking = isChecking,
            billingState = billingState,
            onEmailChange = {
                email = it
                emailError = null
            },
            onRestore = {
                val trimmed = email.trim()
                when {
                    trimmed.isBlank() -> emailError = "Please enter your email address"
                    !trimmed.contains("@") || !trimmed.contains(".") ->
                        emailError = "Please enter a valid email address"
                    else -> billingManager.logIn(trimmed)
                }
            },
            onCancel = onDismiss,
        )
    }
}

/**
 * Stateless restore content. Can be placed in any container (sheet, dialog, screen).
 */
@Composable
fun PayCraftRestoreContent(
    email: String,
    emailError: String?,
    isChecking: Boolean,
    billingState: BillingState,
    onEmailChange: (String) -> Unit,
    onRestore: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 8.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = "Restore Purchases",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }

        Text(
            text = "Enter the email address you used when subscribing. We'll check your subscription status.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(4.dp))

        // Email input
        OutlinedTextField(
            value = email,
            onValueChange = onEmailChange,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(TAG_RESTORE_EMAIL)
                .semantics { contentDescription = "Email address for subscription restore" },
            label = { Text("Email address") },
            placeholder = { Text("you@example.com") },
            leadingIcon = {
                Icon(Icons.Default.Email, contentDescription = null)
            },
            isError = emailError != null,
            singleLine = true,
            enabled = !isChecking,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { onRestore() }),
            supportingText = if (emailError != null) {
                {
                    Text(
                        text = emailError,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag(TAG_RESTORE_ERROR),
                    )
                }
            } else {
                null
            },
        )

        // State feedback
        when (billingState) {
            is BillingState.Error -> {
                Text(
                    text = "No subscription found for this email. Please check the address and try again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(TAG_RESTORE_ERROR),
                )
            }
            is BillingState.Premium -> {
                Text(
                    text = "Subscription restored successfully!",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary,
                    fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(TAG_RESTORE_SUCCESS),
                )
            }
            else -> { /* no message */ }
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Actions
        Button(
            onClick = onRestore,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag(TAG_RESTORE_BUTTON)
                .semantics { contentDescription = "Restore subscription" },
            enabled = !isChecking && email.isNotBlank(),
        ) {
            if (isChecking) {
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
                    Text("Checking…")
                }
            } else {
                Text("Restore Purchases")
            }
        }

        TextButton(
            onClick = onCancel,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .testTag(TAG_RESTORE_CANCEL)
                .semantics { contentDescription = "Cancel restore" },
        ) {
            Text(
                text = "Cancel",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
