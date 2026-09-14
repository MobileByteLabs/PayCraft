package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * The attribution line at the foot of the paywall.
 *
 * Moved out of `BrandedStackTemplate` when D3 deleted it — the tree renderer already composed this
 * OUTSIDE the tree on purpose: attribution is a plan entitlement, not something a tenant may author
 * away by editing their component tree. Living in a template made the renderer depend on a file
 * whose whole point was to be replaceable.
 *
 * `branding` is the tenant's plan setting: "none" (paid removal), "custom" (their own line), or
 * anything else → PayCraft attribution.
 */
@Composable
fun BrandingFooterLine(branding: String, customFooter: String?) {
    val tokens = PayCraftTheme
    when (branding) {
        "none" -> Unit
        "custom" -> customFooter?.let {
            Text(
                text = it,
                color = tokens.colors.onSurfaceVariant,
                fontSize = 10.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                textAlign = TextAlign.Center,
            )
        }
        else -> Text(
            text = "Powered by PayCraft by MobileByteSensei",
            color = tokens.colors.onSurfaceVariant,
            fontSize = 10.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            textAlign = TextAlign.Center,
        )
    }
}
