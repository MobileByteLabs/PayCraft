package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val BADGE_CORNER_RADIUS = 100

/**
 * A small pill badge that displays "ACTIVE" in green to indicate an active subscription.
 *
 * Used inside [PremiumStatusCard] and anywhere you need a visual indicator of active
 * premium status.
 *
 * @param label Text shown inside the badge. Defaults to "ACTIVE".
 * @param containerColor Background color of the pill. Defaults to [MaterialTheme.colorScheme.tertiary].
 * @param contentColor Text color. Defaults to [MaterialTheme.colorScheme.onTertiary].
 */
@Composable
fun ActiveBadge(
    modifier: Modifier = Modifier,
    label: String = "ACTIVE",
    containerColor: Color = MaterialTheme.colorScheme.tertiary,
    contentColor: Color = MaterialTheme.colorScheme.onTertiary,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(BADGE_CORNER_RADIUS.dp))
            .background(containerColor)
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .testTag("paycraft_active_badge")
            .semantics { contentDescription = "Subscription status: $label" },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = contentColor,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.5.sp,
            textAlign = TextAlign.Center,
        )
    }
}
