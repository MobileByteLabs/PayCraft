package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_banner_restore
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import org.jetbrains.compose.resources.stringResource

/**
 * Hero header for the paywall — circular icon container with a title and
 * optional subtitle below. Matches the dashboard's Paywall designer mockup:
 *
 *   [purple rounded-square icon]
 *   Upgrade to Premium             (titleLarge bold)
 *   Ad-free. Unlimited. 4K Downloads.   (bodyMedium muted)
 *
 * The icon defaults to a play triangle (the SDK's media-app default branding). When the
 * tenant uploads their own app's branding mark on the dashboard, its inline SVG path data
 * arrives in [heroIconSvg] and overrides the default — parsed via [rememberHeroIconOverride]
 * so a consumer can fully brand the paywall from the dashboard. A blank/unparseable override
 * falls back to [icon].
 */
@Composable
fun PayCraftPaywallHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector = Icons.Filled.PlayArrow,
    heroIconSvg: String? = null,
) {
    val resolvedIcon = rememberHeroIconOverride(heroIconSvg) ?: icon
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier,
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(64.dp)
                .background(
                    color = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(16.dp),
                )
                .semantics { contentDescription = "Premium icon" },
        ) {
            Icon(
                imageVector = resolvedIcon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(32.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ── Stitch state primitives (sdk-paywall) ───────────────────────────────────────────────────────
// Every non-tree arm of the paywall — premium, pending, empty, config-error, fatal — is the same
// composition in the Stitch designs: a rounded-square hero TILE, a bold headline, a muted body, one
// full-width pill CTA and (on purchase-capable states) the RESTORE link. One implementation, so the
// arms cannot drift into five slightly different screens. Colours are theme tokens only: the SDK is
// host-themed, and Stitch's navy/blue is incidental to its render palette.

/**
 * The hero tile: a rounded square tinted with the brand accent, carrying an accent glyph. [badgeColor]
 * adds the small status dot Stitch puts on the tile's lower-right corner (error, pending).
 */
@Composable
internal fun PaywallHeroTile(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = 72.dp,
    shape: Shape = RoundedCornerShape(size * TILE_CORNER_FRACTION),
    badgeColor: Color? = null,
) {
    val colors = PayCraftTheme.colors
    Box(modifier.size(size)) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .clip(shape)
                .background(colors.accent.copy(alpha = 0.12f))
                .border(1.dp, colors.accent.copy(alpha = 0.32f), shape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(size * TILE_GLYPH_FRACTION),
            )
        }
        if (badgeColor != null) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 4.dp, y = 4.dp)
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(colors.surface)
                    .padding(4.dp)
                    .clip(CircleShape)
                    .background(badgeColor),
            )
        }
    }
}

/** Tile + headline + body, centred — the top half of every Kotlin-owned paywall state. */
@Composable
internal fun PaywallStateHero(
    icon: ImageVector,
    title: String,
    body: String?,
    modifier: Modifier = Modifier,
    badgeColor: Color? = null,
    bodyModifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        PaywallHeroTile(icon = icon, badgeColor = badgeColor)
        Spacer(Modifier.height(24.dp))
        Text(
            text = title,
            color = colors.onSurface,
            fontSize = 26.sp,
            lineHeight = 32.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        if (!body.isNullOrBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = body,
                color = colors.onSurfaceVariant,
                fontSize = 15.sp,
                lineHeight = 22.sp,
                textAlign = TextAlign.Center,
                modifier = bodyModifier,
            )
        }
    }
}

/** The dominant CTA: full width, 56dp, fully rounded, accent fill. */
@Composable
internal fun PaywallPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = PayCraftTheme.colors.accent,
            contentColor = PayCraftTheme.colors.onAccent,
        ),
        modifier = modifier.fillMaxWidth().height(56.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
        }
        Text(text = text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * RESTORE YOUR PREMIUM — the uppercase, letter-spaced text link under the CTA on purchase-capable
 * states. Same copy as the banner's restore so an app never says it two ways.
 */
@Composable
internal fun PaywallRestoreLink(onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON),
    ) {
        Text(
            text = stringResource(Res.string.paycraft_banner_restore).uppercase(),
            color = PayCraftTheme.colors.onSurfaceVariant,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.2.sp,
        )
    }
}

/**
 * A full Kotlin-owned paywall state: hero, then the CTA, then the optional restore link. Centred
 * vertically by [com.mobilebytelabs.paycraft.ui.components.PaywallFrame].
 */
@Composable
internal fun PaywallStateScreen(
    hero: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    primary: (@Composable () -> Unit)? = null,
    onRestore: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        hero()
        if (primary != null) {
            Spacer(Modifier.height(32.dp))
            primary()
        }
        if (onRestore != null) {
            Spacer(Modifier.height(8.dp))
            PaywallRestoreLink(onClick = onRestore)
        }
    }
}

private const val TILE_CORNER_FRACTION = 0.28f
private const val TILE_GLYPH_FRACTION = 0.44f
