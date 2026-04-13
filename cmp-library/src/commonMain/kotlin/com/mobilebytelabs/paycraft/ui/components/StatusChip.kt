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

/**
 * Subscription plan status indicator chip.
 *
 * Displays a small pill with a semantic label indicating the subscription plan state
 * (e.g. "MONTHLY", "YEARLY", "CANCELED", "EXPIRED").  Used inside premium status
 * cards and settings screens to give users a quick visual cue about their plan.
 *
 * ### Recommended usage
 * ```kotlin
 * StatusChip(label = status.plan?.uppercase() ?: "FREE")
 * StatusChip(
 *     label = "CANCELED",
 *     containerColor = MaterialTheme.colorScheme.errorContainer,
 *     contentColor = MaterialTheme.colorScheme.onErrorContainer,
 * )
 * ```
 *
 * @param label Text shown inside the chip.
 * @param containerColor Background color. Defaults to the secondary container role.
 * @param contentColor Text color. Defaults to on-secondary-container.
 * @param testTag Accessibility / UI-test tag for the chip box.
 */
@Composable
fun StatusChip(
    label: String,
    modifier: Modifier = Modifier,
    containerColor: Color = MaterialTheme.colorScheme.secondaryContainer,
    contentColor: Color = MaterialTheme.colorScheme.onSecondaryContainer,
    testTag: String = "paycraft_status_chip_${label.lowercase()}",
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(100.dp))
            .background(containerColor)
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .testTag(testTag)
            .semantics { contentDescription = "Plan: $label" },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = contentColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Pre-built chip variants for common subscription states.
 *
 * These convenience composables set appropriate semantic colours automatically,
 * following standard UX conventions (green = active, red = problem).
 */
object StatusChips {
    /** Green "ACTIVE" chip — subscription is active and in good standing. */
    @Composable
    fun Active(modifier: Modifier = Modifier) = StatusChip(
        label = "ACTIVE",
        containerColor = MaterialTheme.colorScheme.tertiary,
        contentColor = MaterialTheme.colorScheme.onTertiary,
        modifier = modifier,
        testTag = "paycraft_status_chip_active",
    )

    /** Yellow/orange "TRIALING" chip. */
    @Composable
    fun Trialing(modifier: Modifier = Modifier) = StatusChip(
        label = "TRIAL",
        containerColor = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        modifier = modifier,
        testTag = "paycraft_status_chip_trialing",
    )

    /** Red "CANCELED" chip — subscription has been canceled but may still be active. */
    @Composable
    fun Canceled(modifier: Modifier = Modifier) = StatusChip(
        label = "CANCELED",
        containerColor = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = modifier,
        testTag = "paycraft_status_chip_canceled",
    )

    /** Red "EXPIRED" chip — subscription period has ended. */
    @Composable
    fun Expired(modifier: Modifier = Modifier) = StatusChip(
        label = "EXPIRED",
        containerColor = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = modifier,
        testTag = "paycraft_status_chip_expired",
    )

    /** Orange "PAST DUE" chip — payment failed, grace period active. */
    @Composable
    fun PastDue(modifier: Modifier = Modifier) = StatusChip(
        label = "PAST DUE",
        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        modifier = modifier,
        testTag = "paycraft_status_chip_past_due",
    )
}
