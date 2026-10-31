package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_status_active
import com.mobilebytelabs.paycraft.persistence.CheckoutSuccessFlag
import com.mobilebytelabs.paycraft.ui.components.PaywallPrimaryButton
import com.mobilebytelabs.paycraft.ui.components.StatusChip
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * Post-purchase celebration sheet shown after a Free → Premium subscription
 * activation event. Reads `success_title` / `success_message` /
 * `success_cta_label` from the dashboard-configured [PaywallDto] v2 fields.
 *
 * **Once-per-(session × SKU)** — the sheet shows the first time the consumer
 * activates `activatedSku` in this `sessionId`, and is suppressed on
 * subsequent calls (via [CheckoutSuccessFlag], a multiplatform-settings flag
 * keyed `paycraft_success_shown_{sku}_{session_id}`). This prevents the
 * sheet from re-appearing if the host app re-renders after the user dismisses
 * it.
 *
 * Typical wiring from a consumer app:
 * ```kotlin
 * // After PayCraftBillingManager state transitions Free → Premium:
 * if (newPremium != null) {
 *     PayCraftCheckoutSuccessSheet(
 *         activatedSku = newPremium.sku,
 *         sessionId = appSessionId,
 *         onCtaTap = { successSheetVisible.value = false; navigateHome() },
 *         onDismiss = { successSheetVisible.value = false },
 *     )
 * }
 * ```
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftCheckoutSuccessSheet(
    activatedSku: String,
    sessionId: String,
    onCtaTap: () -> Unit,
    onDismiss: () -> Unit,
) {
    val flag = remember { CheckoutSuccessFlag.get() }
    val shouldShow = remember(activatedSku, sessionId) {
        !flag.wasSuccessShown(activatedSku, sessionId)
    }
    if (!shouldShow) {
        // Suppression — fire onDismiss immediately so the host's
        // visibility-state doesn't get stuck waiting on a sheet that never
        // renders. Idempotent because flag.markSuccessShown was already
        // called on the prior invocation.
        LaunchedEffect(activatedSku, sessionId) { onDismiss() }
        return
    }

    val tokens = PayCraftTheme
    val paywall = LocalPayCraftConfig.current?.paywall ?: PaywallDto()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = {
            flag.markSuccessShown(activatedSku, sessionId)
            onDismiss()
        },
        sheetState = sheetState,
        containerColor = tokens.colors.surface,
    ) {
        CheckoutSuccessContent(
            title = paywall.successTitle,
            message = paywall.successMessage,
            ctaLabel = paywall.successCtaLabel,
            // The plan the buyer now owns, named from the live catalogue — never a mockup sample.
            // Unknown sku (catalogue not loaded) → no row rather than a guessed name.
            planName = LocalPayCraftConfig.current?.products?.firstOrNull { it.sku == activatedSku }?.displayName,
            onCta = {
                flag.markSuccessShown(activatedSku, sessionId)
                onCtaTap()
            },
        )
    }
}

/**
 * The success sheet's body (Stitch purchase-success): check emblem, headline, message, the owned-plan
 * row with its ACTIVE pill, and the CTA back to the app. Deliberately NO restore — the buyer has just
 * paid. Split from the modal so it can be rendered and pinned without a window.
 */
@Composable
internal fun CheckoutSuccessContent(
    title: String,
    message: String,
    ctaLabel: String,
    planName: String?,
    onCta: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(colors.accent.copy(alpha = 0.12f))
                .border(1.dp, colors.accent.copy(alpha = 0.32f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(34.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        Text(
            text = title,
            color = colors.onSurface,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message,
            color = colors.onSurfaceVariant,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            textAlign = TextAlign.Center,
        )
        if (planName != null) {
            Spacer(Modifier.height(24.dp))
            val shape = RoundedCornerShape(14.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(colors.onSurface.copy(alpha = 0.04f))
                    .border(1.dp, colors.divider, shape)
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Verified,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    text = planName,
                    color = colors.onSurface,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
                StatusChip(
                    label = stringResource(Res.string.paycraft_status_active),
                    containerColor = colors.activeBadge.copy(alpha = 0.14f),
                    contentColor = colors.activeBadge,
                    testTag = "paycraft_status_chip_active",
                )
            }
        }
        Spacer(Modifier.height(28.dp))
        PaywallPrimaryButton(text = ctaLabel, onClick = onCta)
    }
}

/**
 * Post-checkout continuation variant — renders [PayCraftCheckoutSuccessSheet]
 * first, and once the user taps the CTA (or the sheet dismisses) transitions to
 * the full paywall via [PayCraftPaywallComposable]. Use this for tier-ladder
 * flows where a successful entry-tier purchase should immediately expose the
 * next-tier upgrade options (annual → lifetime, monthly → annual) inside the
 * same session — a pattern shipped by RevenueCat's post-checkout upsell.
 *
 * Delegates through [PayCraftPaywallComposable] so the paywall renders through
 * the single v2 template path (Phase-2 clean-SDK consolidation, AC-4).
 *
 * @param activatedSku SKU the user just activated — same contract as
 *                     [PayCraftCheckoutSuccessSheet].
 * @param sessionId    Session identifier used by [CheckoutSuccessFlag] for
 *                     once-per-session suppression.
 * @param onFinalDismiss Called after the paywall dismisses (or after the success
 *                       sheet dismisses when [showUpgradePaywall] is false).
 * @param showUpgradePaywall When true (default) the paywall opens after CTA tap.
 *                           Set false to skip the upsell and fire [onFinalDismiss]
 *                           straight from the success CTA.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftCheckoutSuccessSheetOrPaywall(
    activatedSku: String,
    sessionId: String,
    onFinalDismiss: () -> Unit,
    showUpgradePaywall: Boolean = true,
) {
    var upsellVisible by remember(activatedSku, sessionId) { mutableStateOf(false) }

    if (upsellVisible) {
        PayCraftPaywallComposable(
            onDismiss = {
                upsellVisible = false
                onFinalDismiss()
            },
            displayMode = DisplayMode.FullScreen,
        )
    } else {
        PayCraftCheckoutSuccessSheet(
            activatedSku = activatedSku,
            sessionId = sessionId,
            onCtaTap = {
                if (showUpgradePaywall) {
                    upsellVisible = true
                } else {
                    onFinalDismiss()
                }
            },
            onDismiss = onFinalDismiss,
        )
    }
}
