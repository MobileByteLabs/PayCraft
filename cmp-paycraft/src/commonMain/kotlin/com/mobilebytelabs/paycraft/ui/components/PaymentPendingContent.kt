package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

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
    val tokens = PayCraftTheme
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp)
            .testTag(PayCraftTestTags.PAYMENT_PENDING),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(32.dp),
            color = tokens.colors.accent,
            strokeWidth = 3.dp,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "Payment pending",
            color = tokens.colors.onSurface,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "Your store is still processing this payment. It can take a few minutes, or up " +
                "to a few days for cash and bank payments.",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "Premium unlocks automatically once it clears — you don't need to buy again.",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(PayCraftTestTags.PAYMENT_PENDING_REASSURANCE),
        )
    }
}
