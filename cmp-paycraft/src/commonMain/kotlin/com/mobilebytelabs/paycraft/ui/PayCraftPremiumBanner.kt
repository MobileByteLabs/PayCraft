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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Drop-in Settings-tab premium upsell banner — the consumer-app entry point to
 * the PayCraft paywall.
 *
 * Defaults match reels-downloader's existing hand-coded banner copy exactly so
 * that a consumer dropping in `PayCraftPremiumBanner()` with NO overrides
 * produces the same look it had before (purple/yellow card, "Upgrade to
 * Premium", "Enjoy ad-free experience, HD downloads, and exclusive features",
 * "Get Premium" button, "Restore Your Premium" link). Every piece of copy
 * comes from [PaywallDto] (v2 — migration 071), but explicit `*Override`
 * parameters take precedence over the dashboard config when the consumer
 * wants to pin a string (e.g. while migrating before the dashboard's
 * Content tab is populated).
 *
 * Color + typography pull from [PayCraftTheme] so the same accent + font
 * that drive the paywall modal also drive this banner — consistent visual
 * identity end-to-end.
 *
 * Typical wiring:
 * ```kotlin
 * PayCraftPremiumBanner(
 *     onGetPremiumTap = { paywallVisible.value = true },
 *     onRestoreTap = { restoreSheetVisible.value = true },
 * )
 * ```
 *
 * Per RULE-EPIC-LOCKED-DECISION D8, the reels-downloader Settings-tab swap of
 * the existing hand-coded banner for this composable is opt-in (90-day grace);
 * the existing `strings.xml` keys stay during the transition so consumers can
 * roll back without churn. See `docs/MIGRATING-TO-PAYCRAFT-PREMIUM-BANNER.md`.
 */
@Composable
fun PayCraftPremiumBanner(
    onGetPremiumTap: () -> Unit,
    onRestoreTap: () -> Unit,
    modifier: Modifier = Modifier,
    titleOverride: String? = null,
    subtitleOverride: String? = null,
    ctaOverride: String? = null,
    restoreOverride: String? = null,
) {
    val tokens = PayCraftTheme
    val paywall = LocalPayCraftConfig.current?.paywall ?: PaywallDto()
    val title = titleOverride ?: paywall.heroTitle
    val subtitle = subtitleOverride ?: paywall.heroSubtitle
    val cta = ctaOverride ?: paywall.ctaGetPremium
    val restore = restoreOverride ?: paywall.restoreLabel

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = tokens.colors.accent),
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
                    containerColor = Color(0xFFFFD93B),  // yellow CTA (matches reels-downloader)
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
