package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.ui.LocalPayCraftPaywallFooterActions
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * The paywall's footer chrome: legal links, then attribution.
 *
 * This is FRAME, not content. Both halves are obligations rather than design — a store review asks
 * for reachable Terms and Privacy on any screen that takes money, and attribution is a plan
 * entitlement — so neither may live in the server-authored tree, where a tenant could author them
 * away by deleting a node (the same reasoning that already kept `BrandingFooterLine` outside the
 * tree; this moves the legal half to the place that was already right).
 *
 * The links were the gap: `PayCraftPaywallFooterActions` has carried `onOpenTerms` / `onOpenPrivacy`
 * since the template era, and the trees that replaced those templates have no node that calls them,
 * so `terms_url` and `privacy_url` were served on every `/config` and rendered by nothing.
 *
 * A URL that is null or blank renders no link at all rather than a dead one — a Terms link that
 * opens nothing is worse than an absent one, because the reviewer and the customer both believe
 * they have been shown terms.
 */
@Composable
fun PaywallChromeFooter(
    termsUrl: String?,
    privacyUrl: String?,
    branding: String,
    customFooter: String?,
    modifier: Modifier = Modifier,
) {
    val tokens = PayCraftTheme
    val actions = LocalPayCraftPaywallFooterActions.current
    val hasTerms = !termsUrl.isNullOrBlank()
    val hasPrivacy = !privacyUrl.isNullOrBlank()

    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (hasTerms || hasPrivacy) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (hasTerms) {
                    Text(
                        text = "Terms",
                        color = tokens.colors.onSurfaceVariant,
                        fontSize = 11.sp,
                        textDecoration = TextDecoration.Underline,
                        modifier = Modifier
                            .clickable { actions.onOpenTerms() }
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                    )
                }
                if (hasTerms && hasPrivacy) {
                    Text(
                        text = "·",
                        color = tokens.colors.onSurfaceVariant,
                        fontSize = 11.sp,
                    )
                }
                if (hasPrivacy) {
                    Text(
                        text = "Privacy Policy",
                        color = tokens.colors.onSurfaceVariant,
                        fontSize = 11.sp,
                        textDecoration = TextDecoration.Underline,
                        modifier = Modifier
                            .clickable { actions.onOpenPrivacy() }
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                    )
                }
            }
        }

        // Attribution sits BELOW the legal row and carries the footer's bottom breathing room. It
        // used to be the last thing in the scrolling tree, which put it hard against the gesture
        // bar with 4dp above it and nothing below — legible in a screenshot, clipped on a device.
        val attribution = when (branding) {
            "none" -> null
            "custom" -> customFooter?.takeIf { it.isNotBlank() }
            else -> "Powered by PayCraft by MobileByteSensei"
        }
        if (attribution != null) {
            Text(
                text = attribution,
                color = tokens.colors.onSurfaceVariant,
                fontSize = 10.sp,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 20.dp),
                textAlign = TextAlign.Center,
            )
        } else {
            // A tenant who paid to remove attribution still gets the spacing it was providing —
            // otherwise buying the upgrade moves the footer under the gesture bar.
            Spacer(Modifier.height(20.dp))
        }
    }
}
