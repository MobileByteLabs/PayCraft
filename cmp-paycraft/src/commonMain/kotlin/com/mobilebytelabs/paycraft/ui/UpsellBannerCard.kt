package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.components.skeleton.BannerShimmerRow
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.ui.theme.parseHexColor
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The [PayCraftBannerStyle.Upsell] body: a flat brand-coloured card that renders NOTHING for a
 * subscriber.
 *
 * This was the public `PayCraftPremiumBanner`. It is internal now because it and `PayCraftBanner`
 * were two public names for one job — observe entitlement, draw a card, offer upgrade and restore —
 * differing only in what a paying user sees. That difference is a style, so it became one.
 *
 * Copy is dashboard-driven ([PaywallDto], migration 071), the same published config the paywall
 * modal renders from, so one edit moves both.
 *
 * The `billingManager` parameter stays as an explicit seam rather than a `koinInject()`: it is
 * nullable because [PayCraft.billingManager] is null before `initialize()`, and that null is
 * MEANINGFUL here — it means "status unknown", which renders the shimmer rather than throwing.
 * Tests drive specific states through it.
 */
@Composable
internal fun UpsellBannerCard(
    onGetPremiumTap: () -> Unit,
    onRestoreTap: () -> Unit,
    modifier: Modifier = Modifier,
    billingManager: BillingManager?,
) {
    val tokens = PayCraftTheme

    // Observe the live billing status so this drop-in upsell is state-aware (it used to
    // always show "Upgrade to Premium" and never shimmer). A null manager (pre-init /
    // no Koin graph yet) is treated as Loading. The stable `remember`ed fallback flow
    // keeps the collectAsState call unconditional (composable-call parity) even as the
    // global manager flips null → non-null after PayCraft.initialize().
    val fallbackState = remember { MutableStateFlow<BillingState>(BillingState.Loading) }
    val billingState by (billingManager?.billingState ?: fallbackState).collectAsState()

    // Premium buyers never see an upsell — collapse to nothing (do NOT nag a paying user).
    if (billingState is BillingState.Premium) return

    // Status not yet known (Loading, or pre-init null manager) → render a layout-matched
    // shimmer card instead of a stale "Upgrade" card, reusing the shared [BannerShimmerRow].
    if (billingState is BillingState.Loading) {
        UpsellBannerShimmer(modifier = modifier)
        return
    }

    // Free / non-premium (Error, DeviceConflict, OwnershipVerified) → the upgrade card.
    // Prefer an explicitly-provided LocalPayCraftConfig; otherwise collect the
    // live SDK config reactively so a dashboard edit recomposes the banner once
    // the cloud fetch (or refreshConfig()) publishes it — no cold relaunch needed.
    val paywall = LocalPayCraftConfig.current?.paywall
        ?: PayCraft.suiteConfigFlow.collectAsState().value?.paywall
        ?: PaywallDto()
    val title = paywall.heroTitle
    val subtitle = paywall.heroSubtitle
    val cta = paywall.ctaGetPremium
    val restore = paywall.restoreLabel

    // Brand color is dashboard-driven: the same `primary_color` that themes the paywall
    // modal also paints this Settings-tab card, so a single dashboard edit drives both
    // surfaces. Falls back to the static accent token only when no primary_color is set.
    val brandColor = paywall.primaryColor
        ?.let(::parseHexColor)
        ?.takeIf { it != Color.Unspecified }
        ?: tokens.colors.accent

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = brandColor),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                StarBadge()
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = title,
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = subtitle,
                        color = Color.White.copy(alpha = 0.85f),
                        fontSize = 13.sp,
                    )
                }
            }

            Spacer(Modifier.height(18.dp))

            Button(
                onClick = onGetPremiumTap,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(26.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFFFFD93B), // yellow CTA (matches reels-downloader)
                    contentColor = Color(0xFF1A1240),
                ),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Star,
                    contentDescription = null,
                    tint = Color(0xFF1A1240),
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = cta,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            Spacer(Modifier.height(12.dp))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onRestoreTap)
                    .padding(vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = restore,
                    color = Color.White.copy(alpha = 0.9f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/**
 * Loading-state stand-in for [UpsellBannerCard] — a layout-matched shimmer card
 * rendered while the billing status is not yet known (cold-start Loading, or a pre-init
 * null billing manager). Reuses the shared [BannerShimmerRow] pill so the banner shows a
 * shimmer instead of a stale "Upgrade to Premium" card, then swaps to the real upgrade
 * card (or collapses when Premium) once [com.mobilebytelabs.paycraft.core.BillingManager.billingState]
 * resolves.
 */
@Composable
private fun UpsellBannerShimmer(modifier: Modifier = Modifier) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Title + subtitle placeholders, then the CTA placeholder — same vertical
            // rhythm as the loaded card so the swap to real content is shift-free.
            BannerShimmerRow()
            BannerShimmerRow()
            Spacer(Modifier.height(6.dp))
            BannerShimmerRow()
        }
    }
}

@Composable
private fun StarBadge() {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.Star,
            contentDescription = null,
            tint = Color(0xFFFFD93B),
            modifier = Modifier.size(24.dp),
        )
    }
}
