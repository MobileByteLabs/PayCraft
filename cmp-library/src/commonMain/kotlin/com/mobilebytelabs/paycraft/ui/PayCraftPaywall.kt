package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.components.BenefitItem
import com.mobilebytelabs.paycraft.ui.components.EmailInputSection
import com.mobilebytelabs.paycraft.ui.components.PlanSelector
import com.mobilebytelabs.paycraft.ui.components.PremiumStatusCard
import org.koin.compose.viewmodel.koinViewModel

/**
 * Full-screen paywall that shows billing plans, benefits, email capture, and premium status.
 *
 * Container composable — collects state from [PayCraftPaywallViewModel] and passes it to
 * [PayCraftPaywallContent] (stateless).
 */
@Composable
fun PayCraftPaywall(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(viewModel.events) {
        viewModel.events.collect { event ->
            when (event) {
                is PayCraftPaywallEvent.Dismissed -> onDismiss()
                is PayCraftPaywallEvent.ErrorOccurred -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> { /* URL events handled by platform */ }
            }
        }
    }

    PayCraftPaywallContent(
        state = state,
        snackbarHostState = snackbarHostState,
        onAction = viewModel::dispatch,
        modifier = modifier,
    )
}

/**
 * Bottom-sheet variant of the paywall.
 * Use when you want to present it as a modal sheet over existing content.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(viewModel.events) {
        viewModel.events.collect { event ->
            when (event) {
                is PayCraftPaywallEvent.Dismissed -> onDismiss()
                else -> {}
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = modifier,
    ) {
        PayCraftPaywallContent(
            state = state,
            snackbarHostState = remember { SnackbarHostState() },
            onAction = viewModel::dispatch,
        )
    }
}

/**
 * Stateless paywall content. Receives state and dispatches actions upward.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallContent(
    state: PayCraftPaywallState,
    snackbarHostState: SnackbarHostState,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier
            .fillMaxSize()
            .testTag(PayCraftTestTags.PAYWALL_SCREEN),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = if (state.isPremium) "Your Premium" else "Upgrade to Premium",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                },
                actions = {
                    IconButton(
                        onClick = { onAction(PayCraftPaywallAction.Dismiss) },
                        modifier = Modifier
                            .size(48.dp)
                            .testTag(PayCraftTestTags.DISMISS_BUTTON)
                            .semantics { contentDescription = "Close paywall" },
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = null,
                        )
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        when (val billingState = state.billingState) {
            is BillingState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag(PayCraftTestTags.LOADING_INDICATOR),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .size(48.dp)
                            .semantics { contentDescription = "Loading billing information" },
                    )
                }
            }

            is BillingState.Premium -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag(PayCraftTestTags.PREMIUM_STATUS_SCREEN),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    item {
                        PremiumStatusCard(
                            status = billingState.status,
                            onManageSubscription = { onAction(PayCraftPaywallAction.ManageSubscription) },
                            onLogOut = { onAction(PayCraftPaywallAction.LogOut) },
                            onRefresh = { onAction(PayCraftPaywallAction.RefreshStatus) },
                        )
                    }

                    if (state.supportEmail.isNotBlank()) {
                        item {
                            TextButton(
                                onClick = { onAction(PayCraftPaywallAction.ContactSupport) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag(PayCraftTestTags.CONTACT_SUPPORT_BUTTON)
                                    .semantics { contentDescription = "Contact support at ${state.supportEmail}" },
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Email,
                                    contentDescription = null,
                                    modifier = Modifier
                                        .padding(end = 8.dp)
                                        .size(18.dp),
                                )
                                Text("Contact Support")
                            }
                        }
                    }
                }
            }

            is BillingState.Free, is BillingState.Error -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag(PayCraftTestTags.PAYWALL_CONTENT),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    if (billingState is BillingState.Error || state.errorMessage != null) {
                        item {
                            val message = (billingState as? BillingState.Error)?.message
                                ?: state.errorMessage
                                ?: "Something went wrong"
                            ErrorBanner(
                                message = message,
                                onDismiss = { onAction(PayCraftPaywallAction.ClearError) },
                                onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                            )
                        }
                    }

                    if (state.benefits.isNotEmpty()) {
                        item {
                            Text(
                                text = "What you get",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        itemsIndexed(
                            items = state.benefits,
                            key = { index, _ -> "benefit_$index" },
                        ) { index, benefit ->
                            BenefitItem(benefit = benefit, index = index)
                        }
                    }

                    if (state.plans.isNotEmpty()) {
                        item {
                            Text(
                                text = "Choose your plan",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            PlanSelector(
                                plans = state.plans,
                                selectedPlan = state.selectedPlan,
                                onPlanSelected = { onAction(PayCraftPaywallAction.SelectPlan(it)) },
                            )
                        }
                    }

                    item {
                        EmailInputSection(
                            email = state.email,
                            emailError = state.emailError,
                            onEmailChange = { onAction(PayCraftPaywallAction.UpdateEmail(it)) },
                            onDone = { onAction(PayCraftPaywallAction.Subscribe) },
                            isEnabled = !state.isSubmitting,
                        )
                    }

                    item {
                        Button(
                            onClick = { onAction(PayCraftPaywallAction.Subscribe) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp)
                                .testTag(PayCraftTestTags.SUBSCRIBE_BUTTON)
                                .semantics {
                                    contentDescription = state.selectedPlan?.let {
                                        "Subscribe to ${it.name} for ${it.price} per ${it.interval}"
                                    } ?: "Subscribe"
                                },
                            enabled = !state.isSubmitting && state.selectedPlan != null,
                        ) {
                            if (state.isSubmitting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                            } else {
                                Text(
                                    text = state.selectedPlan?.let {
                                        "Start ${it.name} — ${it.price}/${it.interval}"
                                    } ?: "Get Premium",
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                    }

                    if (state.isLoggedIn) {
                        item {
                            TextButton(
                                onClick = { onAction(PayCraftPaywallAction.RefreshStatus) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag(PayCraftTestTags.REFRESH_BUTTON)
                                    .semantics { contentDescription = "Refresh premium status" },
                            ) {
                                Text("Already subscribed? Refresh status")
                            }
                        }
                    }

                    if (state.supportEmail.isNotBlank()) {
                        item {
                            TextButton(
                                onClick = { onAction(PayCraftPaywallAction.ContactSupport) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag(PayCraftTestTags.CONTACT_SUPPORT_BUTTON)
                                    .semantics { contentDescription = "Contact support" },
                            ) {
                                Text(
                                    text = "Need help? Contact ${state.supportEmail}",
                                    style = MaterialTheme.typography.labelSmall,
                                    textAlign = TextAlign.Center,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorBanner(message: String, onDismiss: () -> Unit, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.ERROR_MESSAGE),
        colors = androidx.compose.material3.CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            androidx.compose.foundation.layout.Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(
                    onClick = onRetry,
                    modifier = Modifier.height(40.dp),
                ) {
                    Text("Retry", color = MaterialTheme.colorScheme.error)
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .height(40.dp)
                        .testTag(PayCraftTestTags.CLEAR_ERROR_BUTTON),
                ) {
                    Text("Dismiss", color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
        }
    }
}
