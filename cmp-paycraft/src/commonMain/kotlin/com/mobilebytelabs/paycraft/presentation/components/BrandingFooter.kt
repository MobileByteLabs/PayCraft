package com.mobilebytelabs.paycraft.presentation.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.presentation.Branding

/**
 * Footer composable rendered at the bottom of paywall templates.
 *
 * Attribution wordmark renders as:
 *
 *   Powered by **PAYCRAFT**
 *
 * — "Powered by" in regular muted text, "PAYCRAFT" in bold uppercase
 * letter-spaced wordmark style. Matches the dashboard's Paywall designer
 * reference mockup.
 *
 * - [Branding.Attribution] → "Powered by PAYCRAFT"        (Free tier)
 * - [Branding.None]        → renders nothing               (Pro+ tier)
 * - [Branding.Custom]      → renders [customFooterText]    (override)
 */
@Composable
fun BrandingFooter(branding: Branding, customFooterText: String? = null, modifier: Modifier = Modifier) {
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
                    text = poweredByWordmark(),
                    style = MaterialTheme.typography.labelMedium,
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

/**
 * Builds the "Powered by **PAYCRAFT**" two-tone wordmark — "Powered by" in
 * regular weight (muted), "PAYCRAFT" in bold uppercase with subtle tracking.
 */
private fun poweredByWordmark(): AnnotatedString = buildAnnotatedString {
    withStyle(SpanStyle(fontWeight = FontWeight.Normal)) {
        append("Powered by  ")
    }
    withStyle(
        SpanStyle(
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 1.5.sp,
        ),
    ) {
        append("PAYCRAFT")
    }
}
