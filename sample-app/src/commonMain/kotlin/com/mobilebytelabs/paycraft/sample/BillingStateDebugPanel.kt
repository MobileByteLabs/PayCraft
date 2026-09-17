package com.mobilebytelabs.paycraft.sample

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

@Composable
fun BillingStateDebugPanel(modifier: Modifier = Modifier, billingManager: BillingManager = koinInject()) {
    val billingState by billingManager.billingState.collectAsState()
    val userEmail by billingManager.userEmail.collectAsState()
    val scope = rememberCoroutineScope()
    var emailInput by remember { mutableStateOf("") }

    Card(
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Debug Panel",
                style = MaterialTheme.typography.titleMedium,
            )

            // State label
            Text(
                text = billingState.label(),
                modifier = Modifier.testTag("billing_state_label"),
            )

            // Email
            Text(
                text = userEmail ?: "",
                modifier = Modifier.testTag("billing_email"),
            )

            // State-specific fields
            when (val state = billingState) {
                is BillingState.Premium -> {
                    Text(
                        text = state.status.plan ?: "",
                        modifier = Modifier.testTag("billing_plan"),
                    )
                    Text(
                        text = state.status.willRenew.toString(),
                        modifier = Modifier.testTag("billing_will_renew"),
                    )
                    Text(
                        text = state.status.expiresAt ?: "",
                        modifier = Modifier.testTag("billing_expires_at"),
                    )
                    Text(
                        text = state.status.provider ?: "",
                        modifier = Modifier.testTag("billing_provider"),
                    )
                }
                is BillingState.DeviceConflict -> {
                    Text(
                        text = state.conflictingDeviceName ?: "",
                        modifier = Modifier.testTag("billing_conflict_device"),
                    )
                    // `otpAvailable` is gone: the OTP ownership gate was removed from the SDK
                    // (migration 098 dropped it server-side), leaving OAuth + explicit transfer as
                    // the only ownership paths. Surfacing the token's presence instead, which is
                    // what actually drives the transfer flow now.
                    Text(
                        text = state.pendingToken.isNotBlank().toString(),
                        modifier = Modifier.testTag("billing_transfer_pending"),
                    )
                    Text(
                        text = state.email,
                        modifier = Modifier.testTag("billing_conflict_email"),
                    )
                }
                is BillingState.OwnershipVerified -> {
                    Text(
                        text = state.verifiedVia.name,
                        modifier = Modifier.testTag("billing_verified_via"),
                    )
                }
                is BillingState.Error -> {
                    Text(
                        text = state.message,
                        modifier = Modifier.testTag("billing_error_message"),
                    )
                }
                else -> { /* Loading, Free — no extra fields */ }
            }

            // Email input + Login button
            OutlinedTextField(
                value = emailInput,
                onValueChange = { emailInput = it },
                label = { Text("Email") },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("input_email"),
                singleLine = true,
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = { billingManager.registerAndLogin(emailInput) },
                    modifier = Modifier.testTag("btn_login"),
                ) {
                    Text("Login")
                }

                OutlinedButton(
                    onClick = { billingManager.logOut() },
                    modifier = Modifier.testTag("btn_logout"),
                ) {
                    Text("Logout")
                }

                OutlinedButton(
                    onClick = { billingManager.refreshStatus(force = true) },
                    modifier = Modifier.testTag("btn_refresh"),
                ) {
                    Text("Refresh")
                }
            }

            // Device-ownership actions
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = {
                        scope.launch { billingManager.confirmDeviceTransfer() }
                    },
                    modifier = Modifier.testTag("btn_confirm_transfer"),
                ) {
                    Text("Confirm Transfer")
                }

                Button(
                    onClick = {
                        scope.launch {
                            billingManager.loginWithOAuth(OAuthProvider.GOOGLE, "fake-id-token")
                        }
                    },
                    modifier = Modifier.testTag("btn_login_oauth"),
                ) {
                    Text("OAuth")
                }
            }
        }
    }
}

private fun BillingState.label(): String = when (this) {
    is BillingState.Free -> "Free"
    is BillingState.Loading -> "Loading"
    is BillingState.Premium -> "Premium"
    is BillingState.DeviceConflict -> "DeviceConflict"
    is BillingState.OwnershipVerified -> "OwnershipVerified"
    is BillingState.Error -> "Error"
    is BillingState.PaymentPending -> "PaymentPending(${'$'}productId)"
}
