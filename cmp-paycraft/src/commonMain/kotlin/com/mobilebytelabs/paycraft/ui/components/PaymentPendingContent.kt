package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_payment_pending_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_payment_pending_reassurance
import com.mobilebytelabs.paycraft.generated.resources.paycraft_payment_pending_title
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * The surface for [com.mobilebytelabs.paycraft.model.BillingState.PaymentPending].
 *
 * A pending purchase means the store took the order but the money has not cleared: a cash or
 * UPI-mandate payment on Google Play, or a family Ask-to-Buy awaiting a parent's approval on either
 * store. It can take days, and the resolution arrives asynchronously on
 * `NativeBillingClient.purchaseUpdates` rather than as the result of the original purchase call.
 *
 * The copy is deliberate on two counts. It does NOT say the payment failed — the SDK used to render
 * this state through the error branch, which told buyers their money had bounced while it was still
 * in flight, and pushed them into buying a second time. And it explicitly tells the buyer not to
 * pay again, because a duplicate purchase is the expensive failure mode here.
 *
 * There is no retry affordance for the same reason: there is nothing to retry, and the only button
 * we could offer would invite the duplicate charge.
 */
@Composable
fun PaymentPendingContent(productId: String, modifier: Modifier = Modifier) {
    val colors = PayCraftTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 24.dp)
            .testTag(PayCraftTestTags.PAYMENT_PENDING),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PendingEmblem()
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(Res.string.paycraft_payment_pending_title),
            color = colors.onSurface,
            fontSize = 26.sp,
            lineHeight = 32.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(Res.string.paycraft_payment_pending_body),
            color = colors.onSurfaceVariant,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        // The status card (Stitch payment-pending). It carries the one thing a pending buyer must
        // read — do not pay again — rather than the order number Stitch drew: the SDK has no store
        // order reference to show at this point, and an invented one is worse than none.
        val shape = RoundedCornerShape(16.dp)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(colors.onSurface.copy(alpha = 0.04f))
                .border(1.dp, colors.divider, shape)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.Info,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = stringResource(Res.string.paycraft_payment_pending_reassurance),
                color = colors.onSurface,
                fontSize = 14.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f).testTag(PayCraftTestTags.PAYMENT_PENDING_REASSURANCE),
            )
        }
    }
}

/**
 * Hourglass in a soft accent disc, a dashed outer ring (in-flight, not failed) and a clock badge —
 * the Stitch pending emblem. Static: an infinite spinner on a state that can last days reads as hung.
 */
@Composable
private fun PendingEmblem() {
    val colors = PayCraftTheme.colors
    val ring = colors.accent.copy(alpha = 0.45f)
    Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            drawCircle(
                color = ring,
                radius = size.minDimension / 2f - 1.dp.toPx(),
                style = Stroke(
                    width = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
                ),
            )
        }
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(colors.accent.copy(alpha = 0.12f))
                .border(1.dp, colors.accent.copy(alpha = 0.32f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.HourglassTop,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(32.dp),
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = (-14).dp, y = (-14).dp)
                .size(24.dp)
                .clip(CircleShape)
                .background(colors.surface)
                .padding(2.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.tertiary),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Schedule,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiary,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}
