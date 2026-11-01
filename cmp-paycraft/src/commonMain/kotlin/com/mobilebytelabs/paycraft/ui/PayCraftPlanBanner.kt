package com.mobilebytelabs.paycraft.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftPlatform
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_active_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_cta_get_premium
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_cta_manage
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_cta_top_tier
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_cta_upgrade
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_expires
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_plan_subtitle
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_premium_active_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_premium_cd
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_renews
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_restore
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_support_info
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_upgrade_cd
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_upgrade_subtitle
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_upgrade_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_billed_through
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_banner_ends_in
import com.mobilebytelabs.paycraft.generated.resources.paycraft_trial_banner_ends_today
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.provider.StripeProvider
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import com.mobilebytelabs.paycraft.ui.theme.parseHexColor
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private val colorTestMode = Color(0xFFFF6F00) // deep amber — visible on all gradients
private val colorTestModeChip = Brush.linearGradient(listOf(Color(0xFFFF6F00), Color(0xFFFFA000)))

private const val TAG_BANNER_FREE = "paycraft_banner_free"
private const val TAG_BANNER_PREMIUM = "paycraft_banner_premium"
private const val TAG_BANNER_UPGRADE_BTN = "paycraft_banner_upgrade_button"
private const val TAG_BANNER_MANAGE_BTN = "paycraft_banner_manage_button"
private const val TAG_BANNER_RESTORE_BTN = "paycraft_banner_restore_button"

// Gradient palettes — fallbacks only. The free (upsell) card derives its gradient from the
// dashboard `primary_color` via [brandGradient] so the Settings card matches the paywall.
private val gradientFree = listOf(Color(0xFF4A148C), Color(0xFF7B1FA2), Color(0xFFAB47BC))
private val gradientPremium = listOf(Color(0xFF1A237E), Color(0xFF283593), Color(0xFF3949AB))
private val gradientTopTier = listOf(Color(0xFF1B5E20), Color(0xFF2E7D32), Color(0xFF388E3C))

/**
 * Build a 3-stop card gradient from a single dashboard brand color — a darker shade at the
 * top-left fading through the brand color to a lighter shade at the bottom-right. Preserves
 * the card's depth aesthetic while making it fully dashboard-driven (one `primary_color`
 * edit recolors both the paywall and this banner).
 */
private fun brandGradient(primary: Color): List<Color> = listOf(
    lerp(primary, Color.Black, 0.28f),
    primary,
    lerp(primary, Color.White, 0.12f),
)

private val colorGold = Color(0xFFFFD54F)
private val colorCtaGold = Brush.linearGradient(listOf(Color(0xFFFFD54F), Color(0xFFFFC107)))
private val colorCtaManage = Brush.linearGradient(
    listOf(Color.White.copy(alpha = 0.2f), Color.White.copy(alpha = 0.1f)),
)

/**
 * The SDK's billing banner. Observes entitlement and renders itself accordingly.
 *
 * ```kotlin
 * PayCraftPlanBanner()                                        // adaptive, the default
 * PayCraftPlanBanner(style = PayCraftPlanBannerStyle.Upsell)      // hides itself for subscribers
 * ```
 *
 * [PayCraftPlanBannerStyle] explains the two presets and why premium-behaviour and visual weight are
 * bundled rather than independent. `PayCraftPremiumBanner`, which was a second public composable
 * doing this same job, is now [PayCraftPlanBannerStyle.Upsell].
 *
 * ## No callbacks
 *
 * It used to take `onUpgradeClick`, `onManageClick` and `onRestoreClick`, which made a host hold a
 * `var showPaywall` / `var showRestore` and render two sheets — the sample did precisely that, and
 * every consumer would have copied it. The SDK knows all three destinations: its own paywall, the
 * store/provider portal it already resolves for [PayCraftPlanSection], and its own restore
 * sheet. Owning them is why there is nothing left to pass.
 *
 * The restore link still only appears when there is something to restore — a free user — exactly as
 * when the callback was nullable.
 */
@Composable
fun PayCraftPlanBanner(
    modifier: Modifier = Modifier,
    style: PayCraftPlanBannerStyle = PayCraftPlanBannerStyle.Adaptive,
) {
    // Configured check FIRST, before Koin and before requireConfig().
    //
    // Same defect [PayCraftPlanSection] carried until cappy's preview test caught it, with a worse
    // failure: the Adaptive path calls `PayCraft.requireConfig()`, which THROWS on an
    // unconfigured SDK rather than merely failing to resolve. So a @Preview or Roborazzi capture
    // of any host screen containing this banner crashed, and an app that had not called
    // `initialize` crashed at first composition instead of rendering nothing.
    //
    // An app with no publishable key has no billing to show. Returning here is both the fix and
    // the honest behaviour.
    if (!PayCraft.isConfigured) return

    // Both presenters EMIT their sheet here and return a trigger, so the tap completes inside the
    // SDK instead of being handed back to a host that has to render something.
    val showPaywall = rememberPaywallPresenter()
    val showRestore = rememberRestorePresenter()

    // Resolved inside the body, never as a parameter. Which manager drives entitlement is the
    // SDK's concern, not a host's, and BillingManager is internal so it cannot appear in a public
    // signature anyway.
    val billingManager: BillingManager = koinInject()

    if (style == PayCraftPlanBannerStyle.Upsell) {
        UpsellBannerCard(
            onGetPremiumTap = showPaywall,
            onRestoreTap = showRestore,
            modifier = modifier,
            billingManager = billingManager,
        )
        return
    }

    // The facade, for the one ACTION this banner performs itself. manageSubscription() resolves the
    // provider portal or the platform's store page — the same call PayCraftPlanSection
    // makes, rather than a second derivation of where "Manage" goes.
    val repository: PayCraftRepository = koinInject()
    val billingState by billingManager.billingState.collectAsStateWithLifecycle()

    // Retain last stable (non-loading) state — avoids jarring free → premium flash on navigation
    var lastStableState by remember {
        mutableStateOf(billingState.takeIf { it !is BillingState.Loading } ?: BillingState.Free)
    }
    LaunchedEffect(billingState) {
        if (billingState !is BillingState.Loading) {
            lastStableState = billingState
        }
    }

    // Only show loading overlay when refreshing a known-premium state.
    // For free/unknown users on initial load the spinner is just noise.
    val isLoading = billingState is BillingState.Loading && lastStableState is BillingState.Premium

    val benefits = PayCraft.requireConfig().benefits
    // subscriptionPlans, not plans: this picks a TOP TIER by rank, and an unfiltered pick can
    // land on a consumable pack now that the catalogue carries them (PayCraft.subscriptionPlans).
    val plans = PayCraft.subscriptionPlans
    val supportEmail = PayCraft.requireConfig().supportEmail
    // Live dashboard config — drives the free card's brand color + copy reactively, so a
    // dashboard edit recolors/recopies the Settings banner without a cold relaunch.
    val paywall = PayCraft.suiteConfigFlow.collectAsState().value?.paywall ?: PaywallDto()

    Box(modifier = modifier) {
        Crossfade(
            targetState = lastStableState,
            animationSpec = tween(350),
            label = "billing_state_transition",
        ) { state ->
            when (state) {
                is BillingState.Premium -> PremiumBannerCard(
                    status = state.status,
                    trial = state.trial,
                    plans = plans,
                    topTierPlan = plans.maxByOrNull { it.rank },
                    supportEmail = supportEmail,
                    onManageClick = { repository.manageSubscription() },
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> FreeBannerCard(
                    benefits = benefits,
                    paywall = paywall,
                    onUpgradeClick = showPaywall,
                    onRestoreClick = showRestore,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // Semi-transparent white overlay with spinner during status fetch / refresh
        AnimatedVisibility(
            visible = isLoading,
            enter = fadeIn(animationSpec = tween(200)),
            exit = fadeOut(animationSpec = tween(600)),
            modifier = Modifier.matchParentSize(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.White.copy(alpha = 0.55f)),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 2.5.dp,
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Free state
// ─────────────────────────────────────────────────────────────────────────────

@Composable
internal fun FreeBannerCard(
    benefits: List<BillingBenefit>,
    paywall: PaywallDto,
    onUpgradeClick: () -> Unit,
    onRestoreClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    // Dashboard-driven brand color + copy. Each field falls back to the bundled string
    // resource only when the dashboard hasn't set it, so a configured tenant fully controls
    // this card from the Paywall designer (same source as the paywall modal).
    val brand = paywall.primaryColor?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
    val gradient = brand?.let(::brandGradient) ?: gradientFree
    val upgradeTitle = paywall.heroTitle.ifBlank { stringResource(Res.string.paycraft_banner_upgrade_title) }
    val upgradeSubtitle =
        paywall.heroSubtitle.ifBlank { stringResource(Res.string.paycraft_banner_upgrade_subtitle) }
    val ctaText = paywall.ctaGetPremium.ifBlank { stringResource(Res.string.paycraft_banner_cta_get_premium) }
    val restoreText = paywall.restoreLabel.ifBlank { stringResource(Res.string.paycraft_banner_restore) }
    val upgradeCd = stringResource(Res.string.paycraft_banner_upgrade_cd)

    val isTestMode = (PayCraft.config?.provider as? StripeProvider)?.isTestMode == true

    GradientCard(
        gradient = gradient,
        onClick = onUpgradeClick,
        testTag = TAG_BANNER_FREE,
        contentDescription = upgradeCd,
        modifier = modifier,
    ) {
        if (isTestMode) {
            TestModeChip()
            Spacer(Modifier.height(12.dp))
        }

        // Header row
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            IconBox(imageVector = Icons.Default.Star)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = upgradeTitle,
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = upgradeSubtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.85f),
                    lineHeight = 18.sp,
                )
            }
        }

        // Perk list — dashboard `value_props` first (the SAME source as the paywall modal,
        // e.g. "Free Video"), falling back to legacy config `benefits` only when unset.
        val valueProps = paywall.valueProps
        if (valueProps.isNotEmpty()) {
            PerkDivider()
            valueProps.forEach { vp ->
                ValuePropPerkRow(title = vp.title, description = vp.description)
            }
        } else if (benefits.isNotEmpty()) {
            PerkDivider()
            benefits.forEach { benefit ->
                PerkRow(icon = benefit.icon, textRes = benefit.text)
            }
        }

        Spacer(Modifier.height(20.dp))

        // CTA pill — label uses the deepest stop of the card gradient (a dark shade of the
        // dashboard brand color) so it stays high-contrast on the gold pill without a literal.
        // Stitch sdk-plan-card 07: label then a trailing arrow, no leading glyph.
        CtaButton(
            gradient = colorCtaGold,
            icon = null,
            trailingIcon = Icons.AutoMirrored.Filled.ArrowForward,
            textColor = gradient.first(),
            text = ctaText,
            testTag = TAG_BANNER_UPGRADE_BTN,
        )

        // Restore link
        if (onRestoreClick != null) {
            Spacer(Modifier.height(8.dp))
            androidx.compose.material3.TextButton(
                onClick = onRestoreClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(TAG_BANNER_RESTORE_BTN),
            ) {
                Text(
                    text = restoreText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Premium state
// ─────────────────────────────────────────────────────────────────────────────

@Composable
internal fun PremiumBannerCard(
    status: SubscriptionStatus,
    trial: com.mobilebytelabs.paycraft.model.TrialInfo?,
    plans: List<BillingPlan>,
    topTierPlan: BillingPlan?,
    supportEmail: String,
    onManageClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isTestMode = (PayCraft.config?.provider as? StripeProvider)?.isTestMode == true
    val isTopTier = topTierPlan != null && status.plan == topTierPlan.id
    val currentPlan = plans.firstOrNull { it.id == status.plan }
    val currentPlanName = currentPlan?.name
    val gradient = if (isTopTier) gradientTopTier else gradientPremium
    val premiumCd = stringResource(Res.string.paycraft_banner_premium_cd)

    // 4-state CTA logic
    val ctaText = when {
        isTopTier -> stringResource(Res.string.paycraft_banner_cta_top_tier)
        currentPlan != null -> stringResource(Res.string.paycraft_banner_cta_upgrade)
        else -> stringResource(Res.string.paycraft_banner_cta_manage)
    }

    // isTopTier + portal URL configured → open billing portal; otherwise → open paywall
    val email = status.email.orEmpty()
    // `config?`, not `requireConfig()`. This function already reads `PayCraft.config?` sixteen
    // lines up for test mode, so it used BOTH the null-safe and the throwing accessor for the same
    // object — and the throwing one made the card uncomposable without a started SDK, which a
    // screenshot test hit immediately.
    //
    // No config means no provider portal, which is exactly what `false` says here: the CTA then
    // falls through to `onManageClick`, the platform store page. The throw added nothing the
    // fallback does not already handle.
    val hasPortalUrl = PayCraft.config?.provider?.getManageUrl(email) != null
    val ctaClick: () -> Unit = if (isTopTier && email.isNotBlank() && hasPortalUrl) {
        { PayCraft.manageSubscription(email) }
    } else {
        onManageClick
    }

    // Same "14 Nov 2026" shape the settings card renders, so the two surfaces agree on a date.
    val expiryDateDisplay = status.expiresAt?.let(::formatDate)
    // Who bills it, when known — "Renews 14 Nov 2026 · Billed through Google Play".
    val billedThroughTemplate = stringResource(Res.string.paycraft_settings_billed_through)
    val billedThrough = status.provider?.takeIf { it.isNotBlank() }?.let {
        billedThroughTemplate.replace(PlanSectionCopy.TOKEN_STORE, storeDisplayName(it))
    }

    GradientCard(
        gradient = gradient,
        onClick = ctaClick,
        testTag = TAG_BANNER_PREMIUM,
        contentDescription = premiumCd,
        modifier = modifier,
    ) {
        if (isTestMode) {
            TestModeChip()
            Spacer(Modifier.height(12.dp))
        }

        // Header row — Stitch sdk-plan-card 09: tile, "Premium Active", and the Active chip on
        // the SAME line; the plan name is its own line beneath.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            IconBox(imageVector = Icons.Default.CheckCircle, size = 40.dp)
            Text(
                text = stringResource(Res.string.paycraft_banner_premium_active_title),
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            ActiveChip()
        }
        if (currentPlanName != null || trial != null) {
            Spacer(Modifier.height(12.dp))
            Column {
                if (currentPlanName != null) {
                    // T26: show plan name, not raw plan ID
                    Text(
                        text = stringResource(Res.string.paycraft_banner_plan_subtitle, currentPlanName),
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                // Trial countdown (v1.1) — shown only while trialing.
                if (trial != null) {
                    Spacer(Modifier.height(2.dp))
                    val trialText = if (trial.daysRemaining <= 0) {
                        stringResource(Res.string.paycraft_trial_banner_ends_today)
                    } else {
                        stringResource(Res.string.paycraft_trial_banner_ends_in, trial.daysRemaining)
                    }
                    Text(
                        text = trialText,
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.92f),
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.testTag(PayCraftTestTags.TRIAL_BANNER),
                    )
                }
            }
        }

        // Renewal / expiry row — T12: Schedule icon, T25: substringBefore('T')
        if (expiryDateDisplay != null) {
            Spacer(Modifier.height(12.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Schedule,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.7f),
                    modifier = Modifier.size(16.dp),
                )
                val expiryLabel = if (status.willRenew) {
                    stringResource(Res.string.paycraft_banner_renews, expiryDateDisplay)
                } else {
                    stringResource(Res.string.paycraft_banner_expires, expiryDateDisplay)
                }
                Text(
                    text = listOfNotNull(expiryLabel, billedThrough).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.75f),
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Support info BEFORE the CTA, in its own bordered box (Stitch sdk-plan-card 09).
        if (supportEmail.isNotBlank()) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(12.dp))
                    .clickable { PayCraftPlatform.openUrl("mailto:$supportEmail") }
                    .padding(12.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.6f),
                    modifier = Modifier.size(16.dp).padding(top = 2.dp),
                )
                Text(
                    text = stringResource(Res.string.paycraft_banner_support_info, supportEmail),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.75f),
                    lineHeight = 18.sp,
                )
            }
            Spacer(Modifier.height(16.dp))
        }

        // 4-state CTA button — click handled by the enclosing GradientCard
        CtaButton(
            gradient = colorCtaManage,
            icon = Icons.Outlined.Settings,
            trailingIcon = Icons.AutoMirrored.Filled.ArrowForward,
            textColor = Color.White,
            text = ctaText,
            testTag = TAG_BANNER_MANAGE_BTN,
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

@Composable
private fun GradientCard(
    gradient: List<Color>,
    onClick: () -> Unit,
    testTag: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    content: @Composable (androidx.compose.foundation.layout.ColumnScope.() -> Unit),
) {
    OutlinedCard(
        modifier = modifier.fillMaxWidth(),
        onClick = onClick,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        border = CardDefaults.outlinedCardBorder(enabled = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(gradient))
                .testTag(testTag)
                .semantics { this.contentDescription = contentDescription },
        ) {
            // Decorative circles
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .align(Alignment.TopEnd)
                    .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(60.dp)),
            )
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .align(Alignment.BottomStart)
                    .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(40.dp)),
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                content = content,
            )
        }
    }
}

@Composable
private fun IconBox(imageVector: ImageVector, size: androidx.compose.ui.unit.Dp = 52.dp) {
    Box(
        modifier = Modifier
            .size(size)
            .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(size * 0.3f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = imageVector,
            contentDescription = null,
            tint = colorGold,
            modifier = Modifier.size(size * 0.56f),
        )
    }
}

/**
 * "● ACTIVE" pill for the premium card header. Drawn in the card's own white-overlay palette: the
 * card is a fixed gradient, so a host-theme role (activeBadge resolves to `tertiary`) can land
 * mauve-on-green, while white-on-gradient reads on every tier's gradient.
 */
@Composable
private fun ActiveChip() {
    Row(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.18f), RoundedCornerShape(50))
            .border(1.dp, Color.White.copy(alpha = 0.3f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(6.dp).background(colorGold, RoundedCornerShape(50)))
        Text(
            text = stringResource(Res.string.paycraft_banner_active_badge).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp,
            color = Color.White,
        )
    }
}

/** Hairline between a banner's header and its perk list (Stitch sdk-plan-card 07/08). */
@Composable
internal fun PerkDivider(color: Color = Color.White.copy(alpha = 0.15f)) {
    Spacer(Modifier.height(16.dp))
    HorizontalDivider(color = color)
    Spacer(Modifier.height(12.dp))
}

/** A perk's check mark, set in a soft circle so the list reads as ticked items. */
@Composable
private fun PerkCheck(tint: Color) {
    Box(
        modifier = Modifier
            .size(22.dp)
            .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(50)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.Default.Check,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(14.dp),
        )
    }
}

/**
 * Renders a dashboard `value_props` entry (title + optional description) on the gradient
 * card — the banner counterpart to the paywall modal's `ValuePropList`, so the same
 * dashboard copy (e.g. "Free Video") appears on both surfaces.
 */
@Composable
internal fun ValuePropPerkRow(
    title: String,
    description: String?,
    modifier: Modifier = Modifier,
    checkTint: Color = colorGold,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PerkCheck(checkTint)
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.95f),
                fontWeight = FontWeight.SemiBold,
            )
            description?.takeIf { it.isNotBlank() }?.let { desc ->
                Text(
                    text = desc,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.75f),
                    lineHeight = 16.sp,
                )
            }
        }
    }
}

@Composable
private fun PerkRow(icon: ImageVector, textRes: StringResource, modifier: Modifier = Modifier) {
    val text = stringResource(textRes)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(22.dp)
                .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = colorGold, modifier = Modifier.size(14.dp))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.95f),
        )
    }
}

/**
 * Amber chip shown at the top of the banner when [StripeProvider.isTestMode] is true.
 * Invisible in production — zero overhead, no extra parameter needed.
 */
@Composable
private fun TestModeChip(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(colorTestModeChip, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            text = "⚙ TEST MODE — sandbox only, no real charges",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * Compact one-liner paywall banner — the minimal companion to the rich
 * [PayCraftPlanBanner] gradient card. Renders through [PayCraftPaywallComposable] in
 * [DisplayMode.Banner] so the compact strip shares the single paywall path with
 * every other public paywall composable (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Hosts that only need a one-line "Upgrade / Premium active / Verify ownership"
 * strip (typically inside a top app bar or a settings row) can pick this variant
 * instead of the full gradient card. Tapping the strip invokes [onDismiss];
 * hosts usually open the full paywall from there.
 *
 * @param onDismiss Called when the user taps the compact banner strip.
 * @param modifier  Optional modifier applied to the root surface.
 */
@Composable
fun PayCraftInlinePaywallBanner(onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    PayCraftPaywallComposable(
        onDismiss = onDismiss,
        displayMode = DisplayMode.Banner,
        modifier = modifier,
    )
}

@Composable
private fun CtaButton(
    gradient: Brush,
    icon: ImageVector?,
    textColor: Color,
    text: String,
    testTag: String,
    modifier: Modifier = Modifier,
    trailingIcon: ImageVector? = null,
) {
    // A full pill, per the Stitch banners — the card's 24dp corners and a 14dp button read as two
    // unrelated shapes stacked together.
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(gradient, RoundedCornerShape(50))
            .padding(vertical = 14.dp)
            .testTag(testTag),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            icon?.let {
                Icon(imageVector = it, contentDescription = null, tint = textColor, modifier = Modifier.size(20.dp))
            }
            Text(
                text = text,
                style = MaterialTheme.typography.titleSmall,
                color = textColor,
                fontWeight = FontWeight.ExtraBold,
            )
            trailingIcon?.let {
                Icon(imageVector = it, contentDescription = null, tint = textColor, modifier = Modifier.size(18.dp))
            }
        }
    }
}
