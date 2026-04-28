package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_choose_plan
import com.mobilebytelabs.paycraft.generated.resources.paycraft_contact_support_email
import com.mobilebytelabs.paycraft.generated.resources.paycraft_error_description
import com.mobilebytelabs.paycraft.generated.resources.paycraft_error_retry
import com.mobilebytelabs.paycraft.generated.resources.paycraft_error_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_get_premium
import com.mobilebytelabs.paycraft.generated.resources.paycraft_subscribe_cta
import com.mobilebytelabs.paycraft.generated.resources.paycraft_upgrade_plan
import com.mobilebytelabs.paycraft.generated.resources.paycraft_upgrade_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_what_you_get
import com.mobilebytelabs.paycraft.generated.resources.paycraft_your_premium_title
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.provider.StripeProvider
import com.mobilebytelabs.paycraft.ui.components.BenefitItem
import com.mobilebytelabs.paycraft.ui.components.PayCraftActiveSubscriptionBanner
import com.mobilebytelabs.paycraft.ui.components.PayCraftPaywallHeader
import com.mobilebytelabs.paycraft.ui.components.PlanSelector
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/**
 * Full-screen paywall. Observes [PayCraftPaywallViewModel] and delegates rendering.
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
                is PayCraftPaywallEvent.ErrorOccurred -> snackbarHostState.showSnackbar(event.message)
                else -> {}
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
 * Bottom-sheet variant of the paywall. T18: dragHandle = null + refreshStatus on close.
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
        onDismissRequest = {
            // T18: refreshStatus when paywall closes
            viewModel.dispatch(PayCraftPaywallAction.RefreshStatus)
            onDismiss()
        },
        sheetState = sheetState,
        dragHandle = null, // T18: no drag handle
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
 * Stateless paywall content. T27: contentWindowInsets + containerColor. T28: Column + verticalScroll.
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
        // T27: zero insets so sheet handles insets itself
        contentWindowInsets = WindowInsets(0.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = if (state.isPremium) {
                            stringResource(Res.string.paycraft_your_premium_title)
                        } else {
                            stringResource(Res.string.paycraft_upgrade_title)
                        },
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
                        Icon(imageVector = Icons.Default.Close, contentDescription = null)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        val isTestMode = (PayCraft.config?.provider as? StripeProvider)?.isTestMode == true
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            if (isTestMode) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFF6F00))
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "⚙ TEST MODE — sandbox only, no real charges",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            when (val billingState = state.billingState) {
                is BillingState.Loading -> {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding()
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

                // T32: Full-screen error UI with retry
                is BillingState.Error -> {
                    PaywallErrorScreen(
                        message = billingState.message,
                        onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                        modifier = Modifier
                            .fillMaxSize()
                            .padding()
                            .padding(horizontal = 24.dp),
                    )
                }

                // T10: Premium state with active banner + upgrade plan grid
                is BillingState.Premium -> {
                    val currentPlanName = state.plans.firstOrNull {
                        it.rank == state.currentPlanRank
                    }?.name

                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp, vertical = 16.dp)
                            .testTag(PayCraftTestTags.PREMIUM_STATUS_SCREEN),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        // T8: Active subscription banner component
                        PayCraftActiveSubscriptionBanner(
                            status = billingState.status,
                            currentPlanName = currentPlanName,
                        )

                        HorizontalDivider()

                        // Plan grid for upgrades
                        if (state.plans.isNotEmpty()) {
                            Text(
                                text = stringResource(Res.string.paycraft_choose_plan),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            PlanSelector(
                                plans = state.plans,
                                selectedPlan = state.selectedPlan,
                                currentPlanRank = state.currentPlanRank,
                                onPlanSelected = { onAction(PayCraftPaywallAction.SelectPlan(it)) },
                                isPremium = true,
                            )
                        }

                        // Support info BEFORE CTA
                        if (state.supportEmail.isNotBlank()) {
                            SupportInfo(
                                supportEmail = state.supportEmail,
                                onContactSupport = { onAction(PayCraftPaywallAction.ContactSupport) },
                            )
                        }

                        // Upgrade CTA
                        val canUpgrade = state.selectedPlan?.let {
                            state.canUpgrade(it) && !state.isPlanActive(it)
                        } ?: false
                        if (canUpgrade) {
                            Button(
                                onClick = { onAction(PayCraftPaywallAction.Subscribe) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(56.dp)
                                    .testTag(PayCraftTestTags.SUBSCRIBE_BUTTON),
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
                                        text = stringResource(Res.string.paycraft_upgrade_plan),
                                        style = MaterialTheme.typography.labelLarge,
                                    )
                                }
                            }
                        }
                    }
                }

                // T9: Free state with header, benefits, plan grid, CTA
                is BillingState.Free -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp, vertical = 16.dp)
                            .testTag(PayCraftTestTags.PAYWALL_CONTENT),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        // T7: Paywall header component
                        PayCraftPaywallHeader(
                            title = stringResource(Res.string.paycraft_upgrade_title),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        )

                        // Benefits
                        if (state.benefits.isNotEmpty()) {
                            Text(
                                text = stringResource(Res.string.paycraft_what_you_get),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            state.benefits.forEachIndexed { index, benefit ->
                                BenefitItem(benefit = benefit, index = index)
                            }
                        }

                        // Plans — T30: 10dp spacing via PlanSelector Column
                        if (state.plans.isNotEmpty()) {
                            Text(
                                text = stringResource(Res.string.paycraft_choose_plan),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            PlanSelector(
                                plans = state.plans,
                                selectedPlan = state.selectedPlan,
                                currentPlanRank = 0,
                                onPlanSelected = { onAction(PayCraftPaywallAction.SelectPlan(it)) },
                                isPremium = false,
                            )
                        }

                        // Support info BEFORE CTA
                        if (state.supportEmail.isNotBlank()) {
                            SupportInfo(
                                supportEmail = state.supportEmail,
                                onContactSupport = { onAction(PayCraftPaywallAction.ContactSupport) },
                            )
                        }

                        // Get Premium CTA — 56dp
                        Button(
                            onClick = { onAction(PayCraftPaywallAction.Subscribe) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(56.dp)
                                .testTag(PayCraftTestTags.SUBSCRIBE_BUTTON)
                                .semantics {
                                    contentDescription = state.selectedPlan?.let {
                                        "Subscribe to ${it.name} for ${it.price} per ${it.interval}"
                                    } ?: "Get Premium"
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
                                        val cta = Res.string.paycraft_subscribe_cta
                                        stringResource(cta, it.name, it.price, it.interval)
                                    } ?: stringResource(Res.string.paycraft_get_premium),
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                    }
                }

                is BillingState.DeviceConflict -> {
                    // Device conflict is handled by the host screen (SettingsScreen).
                    // The paywall shows a loading indicator while the conflict sheet is open.
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(48.dp))
                    }
                }

                is BillingState.OwnershipVerified -> {
                    // Ownership verified — host screen handles the transfer confirmation dialog.
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(48.dp))
                    }
                }
            } // end when(billingState)
        } // end Column wrapper
    }
}

// T32: Full-screen error UI
@Composable
private fun PaywallErrorScreen(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(Res.string.paycraft_error_title),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message.ifBlank { stringResource(Res.string.paycraft_error_description) },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onRetry,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag(PayCraftTestTags.ERROR_MESSAGE),
        ) {
            Text(stringResource(Res.string.paycraft_error_retry))
        }
    }
}

@Composable
private fun SupportInfo(supportEmail: String, onContactSupport: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(
        onClick = onContactSupport,
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .testTag(PayCraftTestTags.CONTACT_SUPPORT_BUTTON)
            .semantics { contentDescription = "Contact support at $supportEmail" },
    ) {
        Text(
            text = stringResource(Res.string.paycraft_contact_support_email, supportEmail),
            style = MaterialTheme.typography.labelSmall,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
