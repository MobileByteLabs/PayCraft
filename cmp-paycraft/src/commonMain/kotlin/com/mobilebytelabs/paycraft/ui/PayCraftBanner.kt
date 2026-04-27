package com.mobilebytelabs.paycraft.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.generated.resources.Res
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
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.provider.StripeProvider
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

// Gradient palettes matching the original app design
private val gradientFree = listOf(Color(0xFF4A148C), Color(0xFF7B1FA2), Color(0xFFAB47BC))
private val gradientPremium = listOf(Color(0xFF1A237E), Color(0xFF283593), Color(0xFF3949AB))
private val gradientTopTier = listOf(Color(0xFF1B5E20), Color(0xFF2E7D32), Color(0xFF388E3C))

private val colorGold = Color(0xFFFFD54F)
private val colorCtaGold = Brush.linearGradient(listOf(Color(0xFFFFD54F), Color(0xFFFFC107)))
private val colorCtaManage = Brush.linearGradient(
    listOf(Color.White.copy(alpha = 0.2f), Color.White.copy(alpha = 0.1f)),
)

/**
 * Adaptive settings banner that renders a rich gradient card.
 *
 * - **Free user**: purple gradient, perk list, gold "Get Premium" CTA.
 * - **Premium user**: blue/green gradient, plan info, renewal date, support note.
 *
 * Observes [BillingManager.billingState] and switches automatically — no manual
 * state management required.
 *
 * @param onUpgradeClick Invoked when a free user taps the card or CTA.
 * @param onManageClick  Invoked when a premium user taps "Manage Subscription".
 * @param onRestoreClick Optional — shown as a text link for free users.
 */
@Composable
fun PayCraftBanner(
    onUpgradeClick: () -> Unit,
    onManageClick: () -> Unit,
    modifier: Modifier = Modifier,
    onRestoreClick: (() -> Unit)? = null,
    billingManager: BillingManager = koinInject(),
) {
    val billingState by billingManager.billingState.collectAsStateWithLifecycle()
    val isLoading = billingState is BillingState.Loading

    // Retain last stable (non-loading) state — avoids jarring free → premium flash on navigation
    var lastStableState by remember {
        mutableStateOf(billingState.takeIf { it !is BillingState.Loading } ?: BillingState.Free)
    }
    LaunchedEffect(billingState) {
        if (billingState !is BillingState.Loading) {
            lastStableState = billingState
        }
    }

    val benefits = PayCraft.requireConfig().benefits
    val plans = PayCraft.requireConfig().plans
    val supportEmail = PayCraft.requireConfig().supportEmail

    Box(modifier = modifier) {
        Crossfade(
            targetState = lastStableState,
            animationSpec = tween(350),
            label = "billing_state_transition",
        ) { state ->
            when (state) {
                is BillingState.Premium -> PremiumBannerCard(
                    status = state.status,
                    plans = plans,
                    topTierPlan = plans.maxByOrNull { it.rank },
                    supportEmail = supportEmail,
                    onManageClick = onManageClick,
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> FreeBannerCard(
                    benefits = benefits,
                    onUpgradeClick = onUpgradeClick,
                    onRestoreClick = onRestoreClick,
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
private fun FreeBannerCard(
    benefits: List<BillingBenefit>,
    onUpgradeClick: () -> Unit,
    onRestoreClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val upgradeTitle = stringResource(Res.string.paycraft_banner_upgrade_title)
    val upgradeCd = stringResource(Res.string.paycraft_banner_upgrade_cd)

    val isTestMode = (PayCraft.config?.provider as? StripeProvider)?.isTestMode == true

    GradientCard(
        gradient = gradientFree,
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
                    text = stringResource(Res.string.paycraft_banner_upgrade_subtitle),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.85f),
                    lineHeight = 18.sp,
                )
            }
        }

        // Perk list
        if (benefits.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            benefits.forEach { benefit ->
                PerkRow(icon = benefit.icon, textRes = benefit.text)
            }
        }

        Spacer(Modifier.height(16.dp))

        // CTA button
        CtaButton(
            gradient = colorCtaGold,
            icon = Icons.Default.Star,
            textColor = Color(0xFF4A148C),
            text = stringResource(Res.string.paycraft_banner_cta_get_premium),
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
                    text = stringResource(Res.string.paycraft_banner_restore),
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
private fun PremiumBannerCard(
    status: SubscriptionStatus,
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
    val hasPortalUrl = PayCraft.requireConfig().provider.getManageUrl(email) != null
    val ctaClick: () -> Unit = if (isTopTier && email.isNotBlank() && hasPortalUrl) {
        { PayCraft.manageSubscription(email) }
    } else {
        onManageClick
    }

    val expiryDateDisplay = status.expiresAt?.substringBefore('T')

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

        // Header row
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            IconBox(imageVector = Icons.Default.CheckCircle)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(Res.string.paycraft_banner_premium_active_title),
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(2.dp))
                if (currentPlanName != null) {
                    // T26: show plan name, not raw plan ID
                    Text(
                        text = stringResource(Res.string.paycraft_banner_plan_subtitle, currentPlanName),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colorGold,
                        fontWeight = FontWeight.SemiBold,
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
                    text = expiryLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Support info BEFORE the CTA (matches original design)
        if (supportEmail.isNotBlank()) {
            HorizontalDivider(
                color = Color.White.copy(alpha = 0.15f),
                modifier = Modifier.padding(vertical = 8.dp),
            )
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { PayCraftPlatform.openUrl("mailto:$supportEmail") },
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
                    color = Color.White.copy(alpha = 0.6f),
                    lineHeight = 18.sp,
                )
            }
            Spacer(Modifier.height(12.dp))
        }

        // 4-state CTA button — click handled by the enclosing GradientCard
        CtaButton(
            gradient = colorCtaManage,
            icon = Icons.Default.ArrowForward,
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
private fun IconBox(imageVector: ImageVector) {
    Box(
        modifier = Modifier
            .size(52.dp)
            .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(16.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = imageVector,
            contentDescription = null,
            tint = colorGold,
            modifier = Modifier.size(30.dp),
        )
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
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = colorGold,
            modifier = Modifier.size(18.dp),
        )
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

@Composable
private fun CtaButton(
    gradient: Brush,
    icon: ImageVector,
    textColor: Color,
    text: String,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(gradient, RoundedCornerShape(14.dp))
            .padding(vertical = 14.dp)
            .testTag(testTag),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = textColor,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = text,
                style = MaterialTheme.typography.titleSmall,
                color = textColor,
                fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}
