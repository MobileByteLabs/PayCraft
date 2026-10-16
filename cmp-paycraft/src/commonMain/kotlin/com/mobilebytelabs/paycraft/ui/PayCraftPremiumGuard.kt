package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Guards [content] behind a premium check.
 *
 * - If the user is premium: renders [content] directly.
 * - If not premium / loading: shows a lock screen with [onUpgrade] CTA.
 *
 * Usage:
 * ```kotlin
 * PayCraftPremiumGuard(onUpgrade = { showPaywall = true }) {
 *     PremiumFeatureContent()
 * }
 * ```
 */
@Deprecated(
    message = "Superseded by PayCraftPremiumGate. This renders a HOST-AUTHORED lock screen: " +
        "lockTitle/lockDescription/upgradeButtonLabel re-state the offer in app code, and " +
        "`onUpgrade` makes the host own paywall navigation — so copy drifts from the dashboard the " +
        "moment tiers, prices or trial length change, and only an app release can fix it. The gate " +
        "presents the SDK's own paywall from the published workflow instead, and takes no " +
        "`billingManager` (previews use LocalPayCraftEntitlementOverride).",
    replaceWith = ReplaceWith("PayCraftPremiumGate(modifier, content = content)"),
    level = DeprecationLevel.WARNING,
)
@Composable
fun PayCraftPremiumGuard(
    onUpgrade: () -> Unit,
    modifier: Modifier = Modifier,
    lockTitle: String = "Premium Feature",
    lockDescription: String = "Upgrade to unlock this feature and much more.",
    upgradeButtonLabel: String = "Upgrade to Premium",
    content: @Composable () -> Unit,
) {
    // Entitlement from the SAME resolver the replacement gates use. It honours
    // LocalPayCraftEntitlementOverride before touching Koin, so this deprecated guard no longer
    // needs a `billingManager` parameter — which was the last thing keeping that type public — and
    // the deprecation message's promise about previews is true here too.
    //
    // It also keeps the two fixes this guard already carried, rather than re-deriving them:
    //
    //  - gates on isPremium, not `is BillingState.Premium`. The latter is a SECOND derivation of
    //    gating truth, so a buyer in PaymentPending / offline grace / OwnershipVerified was
    //    entitled everywhere else in the app and locked out HERE.
    //  - Loading is its own case. It used to fall into `else`, so a paying customer got the lock
    //    screen for the first frames of every cold start.
    val verdict = rememberGateVerdict()

    when {
        verdict.entitled -> {
            Box(
                modifier = modifier.testTag(PayCraftTestTags.PREMIUM_GUARD_UNLOCKED),
            ) {
                content()
            }
        }

        // No verdict yet — show neither. A lock screen here would be a claim we cannot support.
        verdict.resolving -> Box(modifier = modifier)

        else -> {
            PremiumLockedContent(
                title = lockTitle,
                description = lockDescription,
                upgradeButtonLabel = upgradeButtonLabel,
                onUpgrade = onUpgrade,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun PremiumLockedContent(
    title: String,
    description: String,
    upgradeButtonLabel: String,
    onUpgrade: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .testTag(PayCraftTestTags.PREMIUM_GUARD_LOCKED),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = "Premium feature locked",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(64.dp),
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onUpgrade,
                modifier = Modifier
                    .height(52.dp)
                    .widthIn(min = 200.dp)
                    .testTag(PayCraftTestTags.PREMIUM_GUARD_UPGRADE_BUTTON)
                    .semantics { contentDescription = upgradeButtonLabel },
            ) {
                Text(upgradeButtonLabel)
            }
        }
    }
}

/**
 * Inline-paywall variant of [PayCraftPremiumGuard] — when the user is not premium
 * this composable renders the full paywall inline (via [PayCraftPaywallComposable])
 * instead of the lock screen + callback pattern. Use this when you want the
 * gated feature's parent surface to show the upgrade options directly, without
 * routing the user through a separate paywall screen/sheet.
 *
 * Premium users still see [content] verbatim. Non-premium users see the single
 * paywall path (Phase-2 clean-SDK consolidation, AC-4) rendered in the same
 * container [content] would have occupied.
 *
 * @param onDismiss     Called when the user dismisses the inline paywall (close
 *                      button tap or viewmodel Dismissed event). Hosts usually
 *                      navigate away from the gated surface here.
 * @param modifier      Optional modifier applied to the root container.
 * @param content       Composable rendered when the user is Premium.
 */
@Deprecated(
    message = "Superseded by PayCraftPremiumGate. Migrate straight there: the previous advice here " +
        "was PayCraftPaywallGuardScreen, which is now itself deprecated, so following it cost two " +
        "migrations instead of one. The gate drops `onDismiss` and `billingManager` (the paywall is " +
        "presented through PayCraft's own internal path, so tiers/prices/copy stay dashboard-owned; " +
        "previews use LocalPayCraftEntitlementOverride), and keeps what this was missing — gating " +
        "on isPremium, and Loading as its own state rather than a paywall flash on cold start. " +
        "For an ad-unlockable feature use PayCraftRewardedGate.",
    replaceWith = ReplaceWith("PayCraftPremiumGate(modifier, content = content)"),
    level = DeprecationLevel.WARNING,
)
@Composable
fun PayCraftPremiumGuardInline(onDismiss: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    // Delegates rather than keeping its own copy of the branch: two guards that decide entitlement
    // independently is exactly how the isPremium/billingState disagreement got shipped in the first
    // place. Kept only so existing call sites keep compiling.
    PayCraftPaywallGuardScreen(
        onDismiss = onDismiss,
        modifier = modifier,
        content = content,
    )
}
