package com.mobilebytelabs.paycraft.ui.components

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_plan_line
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_renews_line
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_premium_trial_line
import com.mobilebytelabs.paycraft.generated.resources.paycraft_settings_premium_supporting
import com.mobilebytelabs.paycraft.generated.resources.paycraft_status_active
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * The entitled surface: what a paying subscriber sees instead of a paywall.
 *
 * Promoted out of `BrandedStackTemplate` rather than newly written. Each of the four templates had
 * its own copy of this — the same icon, headline, plan line and trial line with cosmetic wording
 * differences ("You're Premium" vs "You're Premium ✓") that no tenant chose and none could change.
 * A component tree cannot express this arm: it is authored by no one, has no packages to select and
 * nothing to purchase, so it stays Kotlin while the paywall itself becomes data.
 */
@Composable
fun PremiumStatusContent(state: BillingState.Premium) {
    val colors = PayCraftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = 24.dp, end = 24.dp, top = 24.dp)
            .testTag(PayCraftTestTags.PREMIUM_STATUS_SCREEN),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PaywallStateHero(
            icon = Icons.Filled.Check,
            title = stringResource(Res.string.paycraft_premium_title),
            body = null,
        )
        Spacer(Modifier.height(28.dp))

        // The status card (Stitch premium-active): an entitlement glyph, what the buyer owns and
        // until when, and the ACTIVE pill. Every line is real state — no marketing copy.
        val shape = RoundedCornerShape(16.dp)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(colors.onSurface.copy(alpha = 0.04f))
                .border(1.dp, colors.divider, shape)
                .padding(16.dp)
                .testTag(PayCraftTestTags.PREMIUM_STATUS_CARD),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.activeBadge.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.VerifiedUser,
                    contentDescription = null,
                    tint = colors.activeBadge,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                state.status.plan?.let {
                    Text(
                        text = stringResource(Res.string.paycraft_premium_plan_line, it),
                        color = colors.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                }
                Text(
                    text = stringResource(Res.string.paycraft_settings_premium_supporting),
                    color = colors.onSurface,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                state.status.expiresAt?.let {
                    Text(
                        // ISO instants arrive with a time part; the date is the whole message.
                        text = stringResource(Res.string.paycraft_premium_renews_line, it.substringBefore('T')),
                        color = colors.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
                state.trial?.let {
                    Text(
                        text = stringResource(Res.string.paycraft_premium_trial_line, it.daysRemaining),
                        color = colors.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            StatusChip(
                label = stringResource(Res.string.paycraft_status_active),
                containerColor = colors.activeBadge.copy(alpha = 0.14f),
                contentColor = colors.activeBadge,
                testTag = "paycraft_status_chip_active",
            )
        }
    }
}
