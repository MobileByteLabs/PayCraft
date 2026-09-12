package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.ConfigResult
import com.mobilebytelabs.paycraft.ui.components.ConfigUnavailable
import com.mobilebytelabs.paycraft.ui.components.PlansUnavailable
import com.mobilebytelabs.paycraft.ui.components.StaleConfigNotice
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.ProductMapper
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import com.mobilebytelabs.paycraft.presentation.ProviderBottomSheet
import com.mobilebytelabs.paycraft.presentation.ProviderPickerContent
import com.mobilebytelabs.paycraft.provider.StripeProvider
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel
import com.mobilebytelabs.paycraft.model.sessionDisplayPriceFormatted

/**
 * v2 cloud-driven paywall surface — the **single paywall path** for the PayCraft SDK
 * (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Reads tenant config from [LocalPayCraftConfig] (falling back to [PayCraft.suiteConfigFlow]
 * for callers that haven't wrapped with a CompositionLocalProvider), resolves the
 * [PaywallTemplate] enum from `paywall.template` (defaulting to
 * [PaywallTemplate.BRANDED_STACK], the production-grade template that covers every
 * [com.mobilebytelabs.paycraft.model.BillingState] branch including
 * [com.mobilebytelabs.paycraft.model.BillingState.DeviceConflict] and
 * [com.mobilebytelabs.paycraft.model.BillingState.OwnershipVerified]), maps cloud
 * [com.mobilebytelabs.paycraft.config.ProductDto] into the SDK sealed [Product] hierarchy,
 * wraps in [PayCraftThemeProvider] with the live [SuiteConfig] so cloud `theme_jsonb`
 * / `primary_color` overrides win over the host `MaterialTheme.colorScheme` (else
 * host-inherit), and dispatches to the template's `render()`.
 *
 * All the surface chrome the retired v1 [PayCraftPaywall.kt] `v1 hand-built content branch`
 * used to own — the close-button top bar (Scaffold), the test-mode chip, the
 * snackbar host, the provider-picker bottom sheet, and the modal restore sheet —
 * live inside this composable so every downstream public composable
 * ([PayCraftPaywall], [PayCraftPaywallSheet], [BannerPaywall], [PayCraftBanner]'s
 * inline variant, [PayCraftRestore]'s paywall-integrated variant,
 * [PayCraftPremiumGuard]'s inline variant, [PayCraftCheckoutSuccessSheet]'s
 * post-success upsell variant) delegates through this ONE path.
 *
 * Product picks bridge to the existing [PayCraftPaywallAction.SelectPlan] flow via
 * [Product.toBillingPlan] until sub-plan 05's provider-picker work adds a v2-native
 * SelectProduct action.
 *
 * @param onDismiss  Invoked when the paywall's viewmodel emits
 *                   [PayCraftPaywallEvent.Dismissed] (close-button tap, sheet dismiss,
 *                   or a successful restore that navigates away).
 * @param displayMode [DisplayMode.FullScreen] renders a top-bar-plus-template scaffold;
 *                    [DisplayMode.Banner] renders the compact status-strip [BannerPaywall]
 *                    that shares the same [PayCraftPaywallViewModel] state.
 * @param modifier   Optional modifier applied to the root surface.
 * @param viewModel  ViewModel — Koin-injected by default so consumers rarely pass one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallComposable(
    onDismiss: () -> Unit = {},
    displayMode: DisplayMode = DisplayMode.FullScreen,
    modifier: Modifier = Modifier,
    surfaceMode: PayCraftSurfaceMode = PayCraftSurfaceMode.FullScreen,
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

    // Config resolution — CompositionLocal (test/host-supplied) wins over the live cloud
    // flow; both fall through to null so PayCraftThemeProvider host-inherits when nothing
    // is configured yet (cold start). Reactive: a dashboard edit publishes on the flow
    // and the paywall recomposes without a cold relaunch (AC-3).
    val liveConfig = LocalPayCraftConfig.current ?: PayCraft.suiteConfigFlow.collectAsState().value

    // Footer affordances the templates render but cannot wire themselves (they receive no action
    // channel). Privacy/Terms open the tenant's configured URLs; Restore drives the SDK action.
    val uriHandler = LocalUriHandler.current
    val privacyUrl = liveConfig?.paywall?.privacyUrl
    val termsUrl = liveConfig?.paywall?.termsUrl
    val footerActions = remember(privacyUrl, termsUrl, uriHandler, viewModel) {
        PayCraftPaywallFooterActions(
            onOpenPrivacy = {
                privacyUrl?.takeIf { it.isNotBlank() }?.let { runCatching { uriHandler.openUri(it) } }
            },
            onOpenTerms = {
                termsUrl?.takeIf { it.isNotBlank() }?.let { runCatching { uriHandler.openUri(it) } }
            },
            onRestore = { viewModel.dispatch(PayCraftPaywallAction.OpenRestoreSheet) },
        )
    }

    CompositionLocalProvider(
        LocalPayCraftSurfaceMode provides surfaceMode,
        LocalPayCraftPaywallFooterActions provides footerActions,
    ) {
        PayCraftThemeProvider(config = liveConfig) {
            val sheetTarget = state.providerSheetTarget
            val restoreVisible = state.isRestoreSheetVisible

            // A secondary surface (provider picker / restore) is showing. How we present it depends
            // entirely on whether WE are already inside a modal window:
            //  - Sheet mode  → swap it into the SAME sheet. Opening a second ModalBottomSheet from
            //    inside one stacks two scrims and two windows (UI-3), which is what made the host
            //    app disappear behind an opaque layer.
            //  - FullScreen  → we are a screen, not a sheet, so a real modal sheet on top is right.
            val secondary: (@Composable () -> Unit)? = when {
                sheetTarget != null -> {
                    {
                        ProviderPickerContent(
                            providers = state.suiteProviders,
                            selectedPlan = sheetTarget,
                            maxVisible = 4,
                            onProviderPicked = { provider ->
                                viewModel.dispatch(
                                    PayCraftPaywallAction.CheckoutWithProvider(sheetTarget, provider),
                                )
                            },
                        )
                    }
                }
                restoreVisible -> {
                    {
                        PayCraftRestoreContent(
                            billingManager = koinInject(),
                            onCancel = { viewModel.dispatch(PayCraftPaywallAction.CloseRestoreSheet) },
                            onSuccess = { viewModel.dispatch(PayCraftPaywallAction.CloseRestoreSheet) },
                        )
                    }
                }
                else -> null
            }

            if (surfaceMode == PayCraftSurfaceMode.Sheet && secondary != null) {
                // ONE modal window: the secondary surface replaces the paywall body in place.
                secondary()
            } else {
                PayCraftPaywallBody(
                    state = state,
                    config = liveConfig,
                    displayMode = displayMode,
                    surfaceMode = surfaceMode,
                    snackbarHostState = snackbarHostState,
                    onDismiss = onDismiss,
                    onAction = viewModel::dispatch,
                    modifier = modifier,
                )
            }

            if (surfaceMode == PayCraftSurfaceMode.FullScreen) {
                // Provider-picker modal — floats above every display mode so a plan tap in either
                // FullScreen or Banner mode surfaces the picker uniformly.
                if (sheetTarget != null) {
                    ProviderBottomSheet(
                        providers = state.suiteProviders,
                        selectedPlan = sheetTarget,
                        maxVisible = 4,
                        onProviderPicked = { provider ->
                            viewModel.dispatch(
                                PayCraftPaywallAction.CheckoutWithProvider(sheetTarget, provider),
                            )
                        },
                        onDismiss = { viewModel.dispatch(PayCraftPaywallAction.DismissProviderSheet) },
                    )
                }

                // Restore-purchases modal — triggered by the legal-footer RESTORE link (via
                // PayCraftPaywallAction.OpenRestoreSheet) or by the host opening it directly.
                // OAuth handlers stay null at the SDK layer — consumer apps wire them via the
                // PayCraftPaywallSheet / PayCraftPaywall overloads.
                PayCraftRestore(
                    visible = restoreVisible,
                    onDismiss = { viewModel.dispatch(PayCraftPaywallAction.CloseRestoreSheet) },
                )
            }
        }
    }
}

/**
 * The paywall body — Banner strip, or the Scaffold render path (close-button top bar + optional
 * test-mode chip + [PaywallTemplate.render], BrandedStackTemplate by default).
 *
 * Extracted so [PayCraftPaywallComposable] can choose between paywall body and a secondary
 * surface without duplicating the display-mode branch.
 */
@Composable
private fun PayCraftPaywallBody(
    state: PayCraftPaywallState,
    config: SuiteConfig?,
    displayMode: DisplayMode,
    surfaceMode: PayCraftSurfaceMode,
    snackbarHostState: SnackbarHostState,
    onDismiss: () -> Unit,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (displayMode) {
        DisplayMode.Banner -> BannerPaywall(
            state = state.billingState,
            onTap = onDismiss,
            modifier = modifier,
        )
        DisplayMode.FullScreen -> PayCraftPaywallSurface(
            state = state,
            config = config,
            snackbarHostState = snackbarHostState,
            onAction = onAction,
            surfaceMode = surfaceMode,
            modifier = modifier,
        )
    }
}

/**
 * Scaffold render path for [DisplayMode.FullScreen].
 *
 * [surfaceMode] decides who owns bounds and background, and it is the whole fix for the
 * "paywall goes blank behind the sheet" bug:
 *  - [PayCraftSurfaceMode.FullScreen] — we own the window: `fillMaxSize()` + an opaque container.
 *  - [PayCraftSurfaceMode.Sheet] — the hosting [androidx.compose.material3.ModalBottomSheet] owns
 *    bounds, shape, background AND scrim. We fill width, wrap height (capped so a tall paywall
 *    still leaves the host visible above the sheet), and keep the container TRANSPARENT. A
 *    `fillMaxSize()` + opaque container here expands the sheet to the full window and paints over
 *    the scrim, which is exactly what made the background go blank.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PayCraftPaywallSurface(
    state: PayCraftPaywallState,
    config: SuiteConfig?,
    snackbarHostState: SnackbarHostState,
    onAction: (PayCraftPaywallAction) -> Unit,
    surfaceMode: PayCraftSurfaceMode,
    modifier: Modifier = Modifier,
) {
    val isSheet = surfaceMode == PayCraftSurfaceMode.Sheet
    val sizing = if (isSheet) {
        Modifier.fillMaxWidth().wrapContentHeight().heightIn(max = SHEET_MAX_HEIGHT)
    } else {
        Modifier.fillMaxSize()
    }
    Scaffold(
        modifier = modifier
            .then(sizing)
            .testTag(PayCraftTestTags.PAYWALL_SCREEN),
        // Sheet callers set zero insets so the sheet handles insets itself.
        contentWindowInsets = WindowInsets(0.dp),
        containerColor = if (isSheet) Color.Transparent else MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = { /* Template renders its own hero title — top bar stays chromeless. */ },
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
        val contentSizing = if (isSheet) Modifier.fillMaxWidth() else Modifier.fillMaxSize()
        Column(modifier = contentSizing.padding(innerPadding)) {
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
            // Plan cards come from the cloud /config fetch ([PayCraft.suiteConfigFlow]),
            // which resolves on a SEPARATE signal from [BillingState]. On cold start the
            // billing manager can resolve Loading → Free (no saved email) BEFORE /config
            // products arrive — so `config == null` while `state.billingState` is already
            // Free. Rendering the template's Free branch then would show BrandedStackFree
            // with an empty ProductList + disabled Continue button and NO shimmer.
            //
            // Treat "cloud config not yet resolved" (config == null) as products-still-
            // loading and render the SAME layout-matched [PaywallSkeleton] the
            // BillingState.Loading branch uses, until the config flow republishes non-null
            // (products load "in realtime" via the collectAsState above). Premium buyers
            // are exempt — their status renders without any product/config. A warm cache
            // (config already non-null) never forces the skeleton, so there is no flash;
            // once config resolves non-null the real content renders even if products is
            // genuinely empty (a real empty-state, not loading).
            // The skeleton is now gated on the RESILIENCE OUTCOME, not on `config == null`.
            //
            // `config == null` meant four different things — never fetched, fetch in flight, HTTP
            // error, and offline — and rendered a spinner for all of them. Three of those are
            // terminal, so the spinner never went away; on a host that gates onboarding behind the
            // paywall, that stranded the user inside a shipped app. Loading is the only outcome a
            // spinner is honest for.
            val configResult by PayCraft.configResultFlow.collectAsState()
            val productsLoading = configResult.isLoading &&
                config == null &&
                state.billingState !is BillingState.Premium
            if (productsLoading) {
                PaywallSkeleton(planCount = 3)
            } else if (config == null && state.billingState !is BillingState.Premium) {
                // Every layer failed and there is nothing to price. Say so, and offer retry only
                // when the failure might actually be transient.
                ConfigUnavailable(
                    result = configResult,
                    onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                    // Non-retryable failures would otherwise leave the user with no action at all;
                    // Dismiss travels the normal path (VM -> Dismissed event -> host's onDismiss).
                    onDismiss = { onAction(PayCraftPaywallAction.Dismiss) },
                )
            } else {
                val template = PaywallTemplate.parse(config?.paywall?.template.orEmpty())
                val products: List<Product> = config?.products
                    ?.filter { it.active }
                    ?.map(ProductMapper::fromDto)
                    ?.sortedBy { it.displayOrder }
                    ?: emptyList()

                // Config is healthy but there is nothing to sell — a new tenant, or store products
                // not published yet. Rendering the template here produces a paywall with a hero, no
                // plan cards and a CTA that cannot do anything: a silent dead end that looks like a
                // layout bug. Say what is actually true instead. (Premium users still get their
                // template below — they have an entitlement to see even with no plans on offer.)
                if (products.isEmpty() && state.billingState !is BillingState.Premium) {
                    PlansUnavailable(onDismiss = { onAction(PayCraftPaywallAction.Dismiss) })
                } else {
                    // AC-21: a warm cache offline renders last week's prices. Saying nothing would
                    // present them as current, which is the one thing a paywall must not do.
                    if (configResult.isStale) {
                        StaleConfigNotice(
                            ageSeconds = (configResult as? ConfigResult.Stale)?.ageSeconds ?: 0L,
                            onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                        )
                    }
                    template.render(
                        state = state.billingState,
                        products = products,
                        onPickProduct = { product ->
                            onAction(PayCraftPaywallAction.SelectPlan(product.toBillingPlan(config)))
                        },
                        onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                        onAction = onAction,
                    )
                }
            }
        }
    }
}

/**
 * Bridge a v2 [Product] to the v1 [BillingPlan] sealed-interface flow used by the
 * existing viewmodel. Handles the pre-init cold-cache path (config = null) by
 * falling through to the product's own base-price format.
 */
private fun Product.toBillingPlan(config: SuiteConfig?): BillingPlan {
    val dtoMatch = config?.products?.firstOrNull { it.id == this.id }
    val priced = dtoMatch?.resolvedPrice
    val priceLabel = when {
        priced != null -> Money(priced.amountCents, priced.currency).format()
        this is Product.Subscription -> sessionDisplayPriceFormatted().orEmpty()
        this is Product.Lifetime -> sessionDisplayPriceFormatted().orEmpty()
        this is Product.Trial -> "Free"
        else -> ""
    }
    val intervalLabel = when (this) {
        is Product.Subscription -> when (interval) {
            Product.Subscription.Interval.MONTH -> "month"
            Product.Subscription.Interval.QUARTER -> "quarter"
            Product.Subscription.Interval.SEMIANNUAL -> "6mo"
            Product.Subscription.Interval.YEAR -> "year"
        }
        is Product.Trial -> "trial"
        is Product.Lifetime -> "lifetime"
    }
    val trialDays = (this as? Product.Trial)?.durationDays
    return BillingPlan(
        id = id,
        name = displayName,
        price = priceLabel,
        interval = intervalLabel,
        rank = displayOrder,
        trialDays = trialDays,
    )
}

/**
 * Height ceiling for the paywall when hosted in a bottom sheet. Leaves a strip of the host app
 * (and its scrim) visible above the sheet, so it reads as a sheet over the app rather than an
 * opaque takeover — even when the template's content is taller than the screen.
 */
private val SHEET_MAX_HEIGHT = 720.dp
