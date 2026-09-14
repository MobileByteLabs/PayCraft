package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Billing failed and the user can retry.
 *
 * Distinct from [ConfigUnavailable], which covers the config FETCH failing before there is a paywall
 * at all. This one is reached once billing is running and a call went wrong, so the action offered
 * is a retry of that call rather than a reload of the surface.
 */
@Composable
fun PaywallErrorContent(message: String, onRetry: () -> Unit) {
    val tokens = PayCraftTheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Something went wrong",
            color = tokens.colors.onSurface,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = message,
            color = tokens.colors.onSurfaceVariant,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(
                containerColor = tokens.colors.accent,
                contentColor = tokens.colors.onAccent,
            ),
            shape = RoundedCornerShape(26.dp),
        ) { Text("Retry") }
    }
}
