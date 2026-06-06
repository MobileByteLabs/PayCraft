package com.mobilebytelabs.paycraft.presentation.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.presentation.Branding

/**
 * Footer composable rendered at the bottom of paywall templates.
 *
 * - [Branding.Attribution] → "Powered by PayCraft by MobileByteSensei" (Free tier)
 * - [Branding.None] → renders nothing (Pro+ tier)
 * - [Branding.Custom] → renders [customFooterText] if provided, otherwise [Branding.Custom.footer]
 */
@Composable
fun BrandingFooter(
    branding: Branding,
    customFooterText: String? = null,
    modifier: Modifier = Modifier,
) {
    when (branding) {
        is Branding.None -> Unit

        is Branding.Attribution -> {
            Box(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Powered by PayCraft by MobileByteSensei",
                    style = MaterialTheme.typography.labelLarge,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        is Branding.Custom -> {
            if (customFooterText != null) {
                Box(
                    modifier = modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = customFooterText,
                        style = MaterialTheme.typography.labelLarge,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                branding.footer()
            }
        }
    }
}
