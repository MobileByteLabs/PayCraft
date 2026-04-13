package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags

@Composable
fun EmailInputSection(
    email: String,
    emailError: String?,
    onEmailChange: (String) -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Email address",
    isEnabled: Boolean = true,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.EMAIL_INPUT_SECTION),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        OutlinedTextField(
            value = email,
            onValueChange = onEmailChange,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(PayCraftTestTags.EMAIL_TEXT_FIELD)
                .semantics { contentDescription = "Email address input field" },
            label = { Text(label) },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Email,
                    contentDescription = "Email icon",
                )
            },
            isError = emailError != null,
            singleLine = true,
            enabled = isEnabled,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(
                onDone = { onDone() },
            ),
            supportingText = if (emailError != null) {
                {
                    Text(
                        text = emailError,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.testTag(PayCraftTestTags.EMAIL_ERROR_TEXT),
                    )
                }
            } else {
                null
            },
        )
    }
}
