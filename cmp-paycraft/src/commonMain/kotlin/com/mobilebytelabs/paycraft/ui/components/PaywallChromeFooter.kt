package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_paywall_attribution
import com.mobilebytelabs.paycraft.generated.resources.paycraft_paywall_close_cd
import com.mobilebytelabs.paycraft.generated.resources.paycraft_paywall_link_separator
import com.mobilebytelabs.paycraft.generated.resources.paycraft_paywall_privacy
import com.mobilebytelabs.paycraft.generated.resources.paycraft_paywall_terms
import com.mobilebytelabs.paycraft.ui.LocalPayCraftPaywallFooterActions
import com.mobilebytelabs.paycraft.ui.LocalPayCraftSurfaceMode
import com.mobilebytelabs.paycraft.ui.PayCraftSurfaceMode
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.paywallContentSize
import com.mobilebytelabs.paycraft.ui.paywallRoot
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * The paywall's footer chrome: a hairline, legal links, then attribution.
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
        modifier = modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // The hairline that separates the frame from the content (Stitch: every state).
        HorizontalDivider(color = tokens.colors.divider, modifier = Modifier.padding(bottom = 10.dp))
        if (hasTerms || hasPrivacy) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (hasTerms) {
                    FooterLink(stringResource(Res.string.paycraft_paywall_terms)) { actions.onOpenTerms() }
                }
                if (hasTerms && hasPrivacy) {
                    Text(
                        text = stringResource(Res.string.paycraft_paywall_link_separator),
                        color = tokens.colors.onSurfaceVariant,
                        fontSize = 12.sp,
                    )
                }
                if (hasPrivacy) {
                    FooterLink(stringResource(Res.string.paycraft_paywall_privacy)) { actions.onOpenPrivacy() }
                }
            }
        }

        // Attribution sits BELOW the legal row and carries the footer's bottom breathing room. It
        // used to be the last thing in the scrolling tree, which put it hard against the gesture
        // bar with 4dp above it and nothing below — legible in a screenshot, clipped on a device.
        val attribution = when (branding) {
            "none" -> null
            "custom" -> customFooter?.takeIf { it.isNotBlank() }
            else -> stringResource(Res.string.paycraft_paywall_attribution)
        }
        if (attribution != null) {
            Text(
                text = attribution,
                color = tokens.colors.onSurfaceVariant.copy(alpha = 0.8f),
                fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 20.dp),
                textAlign = TextAlign.Center,
            )
        } else {
            // A tenant who paid to remove attribution still gets the spacing it was providing —
            // otherwise buying the upgrade moves the footer under the gesture bar.
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun FooterLink(text: String, onClick: () -> Unit) {
    Text(
        text = text,
        color = PayCraftTheme.colors.onSurfaceVariant,
        fontSize = 12.sp,
        textDecoration = TextDecoration.Underline,
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
    )
}

/**
 * THE FRAME every paywall state renders inside: bounds, surface, ONE vertical scroll, and the footer.
 *
 * Scrolling lives here rather than in any arm because every arm can overflow — a third plan card, a
 * long error, a device-conflict explanation — and each one solving it separately means each one can
 * forget, which is how a purchase button ends up below the fold with no way to reach it.
 *
 * When the frame has a bounded viewport (full screen), the page is stretched to at least the
 * viewport so the footer sits at the BOTTOM of a short state instead of directly under it, and a
 * [centerContent] state (premium, pending, the error and empty screens) sits in the middle — the
 * Stitch composition. Inside a wrap-height sheet there is no viewport to fill, so it simply wraps:
 * stretching there would force the sheet to full height, the exact bug sheet mode exists to prevent.
 *
 * [banner] renders above the state inside the scroll (stale-cache notice, checkout failure), so it
 * reads as part of the page rather than a strip pinned over it.
 */
@Composable
internal fun PaywallFrame(
    background: Color,
    centerContent: Boolean,
    modifier: Modifier = Modifier,
    banner: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.paywallRoot(background)) {
        // FullScreen only: a sheet's bounded max height is a CEILING, not a size to fill.
        val fullScreen = LocalPayCraftSurfaceMode.current == PayCraftSurfaceMode.FullScreen
        val viewport = if (fullScreen && constraints.hasBoundedHeight) maxHeight else null
        Column(
            modifier = Modifier
                .paywallContentSize()
                .verticalScroll(rememberScrollState())
                .then(if (viewport != null) Modifier.heightIn(min = viewport) else Modifier),
        ) {
            banner?.invoke()
            // Weighted SPACERS, never a weighted content region: a weight would give the state an
            // exact height and clip a tall one instead of letting it scroll. Spacers absorb only
            // the slack (zero when the state overflows), so short states centre / sit on top with
            // the footer at the bottom, and tall ones simply flow.
            if (viewport != null && centerContent) Spacer(Modifier.weight(1f))
            Column(modifier = Modifier.fillMaxWidth(), content = content)
            if (viewport != null) Spacer(Modifier.weight(1f))
            val paywall = LocalPayCraftConfig.current?.paywall
            PaywallChromeFooter(
                termsUrl = paywall?.termsUrl,
                privacyUrl = paywall?.privacyUrl,
                branding = paywall?.branding ?: "attribution",
                customFooter = paywall?.customFooter,
            )
        }
    }
}

/**
 * The chromeless top bar: nothing but a circular, outlined close button at the trailing edge.
 * The tree renders its own hero, so a title here would be a second headline.
 */
@Composable
internal fun PaywallTopBar(onClose: () -> Unit, modifier: Modifier = Modifier) {
    val colors = PayCraftTheme.colors
    val closeCd = stringResource(Res.string.paycraft_paywall_close_cd)
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.End,
    ) {
        IconButton(
            onClick = onClose,
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(colors.onSurface.copy(alpha = 0.06f))
                .border(1.dp, colors.divider, CircleShape)
                .testTag(PayCraftTestTags.DISMISS_BUTTON)
                .semantics { contentDescription = closeCd },
        ) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = null,
                tint = colors.onSurface,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
