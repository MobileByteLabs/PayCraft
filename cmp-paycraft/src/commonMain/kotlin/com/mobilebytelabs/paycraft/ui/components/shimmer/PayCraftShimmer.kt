/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Host-theme-safe shimmer Modifier system for the PayCraft paywall/skeleton layer.
 * Ported (in-tree, no dependency) from byte-wallpaper `core/ui/Shimmer.kt` so the
 * cmp-paycraft SDK stays Maven-publishable with zero design-system coupling — every
 * function reads only [MaterialTheme.colorScheme] tonal roles inherited from the
 * consumer app's `MaterialTheme`, so the shimmer visually matches whatever theme
 * the host resolved (light/dark, branded, dashboard-overridden).
 *
 * Reduced-motion posture (AC-14): every animated Modifier below accepts a
 * `reduceMotion: Boolean` flag; when `true` the Modifier collapses to a static
 * `background(surfaceVariant)` — no infinite animation, no CPU cost — so the
 * skeleton remains a visible placeholder on OS reduce-motion / accessibility.
 */
package com.mobilebytelabs.paycraft.ui.components.shimmer

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawOutline

/**
 * Shimmer wave effect — a highlight sweeps horizontally across the component.
 *
 * Automatically adapts to light/dark theme using [MaterialTheme.colorScheme.surface]
 * and [MaterialTheme.colorScheme.surfaceVariant], so the shimmer visually matches the
 * host app's theme with zero design-system coupling.
 *
 * @param shape          The outline the shimmer is drawn against — typically a
 *                       [RoundedCornerShape] matching the shape of the placeholder Box
 *                       or the loaded item it stands in for.
 * @param durationMillis Sweep duration in millis. Ignored when [reduceMotion] is true.
 * @param reduceMotion   When `true` collapses to a static [background] of
 *                       `surfaceVariant` — no infinite animation, so the skeleton
 *                       remains a visible placeholder on OS reduce-motion (AC-14).
 */
fun Modifier.shimmerWave(
    shape: Shape = RectangleShape,
    durationMillis: Int = 1500,
    reduceMotion: Boolean = false,
): Modifier = composed {
    // Use MaterialTheme colors for proper theme integration — never a hardcoded palette.
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant
    val surface = MaterialTheme.colorScheme.surface

    if (reduceMotion) {
        // Shaped: a static placeholder must keep the outline of what it stands in for — a square
        // where a pill CTA will land is a layout shift the shimmer exists to avoid.
        return@composed background(surfaceVariant, shape)
    }

    val baseColor = surfaceVariant
    val glowColor = surface.copy(alpha = 0.7f).compositeOver(surfaceVariant)
    val highlightColor = surface

    val transition = rememberInfiniteTransition(label = "paycraft_shimmer_wave")
    val translateX by transition.animateFloat(
        initialValue = -1f,
        targetValue = 2f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = durationMillis, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "paycraft_shimmer_translate",
    )

    drawWithCache {
        val width = size.width
        val height = size.height
        val shimmerWidth = width * 0.4f
        val offset = width * translateX

        val shimmerBrush = Brush.linearGradient(
            colors = listOf(baseColor, glowColor, highlightColor, glowColor, baseColor),
            start = Offset(offset, 0f),
            end = Offset(offset + shimmerWidth, height),
        )

        val outline = shape.createOutline(size, layoutDirection, this)

        onDrawBehind {
            drawOutline(outline = outline, color = baseColor)
            drawOutline(outline = outline, brush = shimmerBrush)
        }
    }
}

/**
 * Pulse glow effect — a soft radial glow pulses across the component, similar to
 * Instagram/Pinterest loading placeholders. Reads [MaterialTheme.colorScheme] so
 * light/dark theming is automatic.
 *
 * @param shape          The outline drawn against.
 * @param durationMillis Pulse duration. Ignored when [reduceMotion] is true.
 * @param reduceMotion   When `true` collapses to a static `surfaceVariant`
 *                       background (AC-14).
 */
fun Modifier.pulseGlow(
    shape: Shape = RectangleShape,
    durationMillis: Int = 1200,
    reduceMotion: Boolean = false,
): Modifier = composed {
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant
    val surface = MaterialTheme.colorScheme.surface

    if (reduceMotion) {
        return@composed background(surfaceVariant)
    }

    val baseColor = surfaceVariant
    val glowColor = surface.copy(alpha = 0.7f).compositeOver(surfaceVariant)
    val highlightColor = surface

    val transition = rememberInfiniteTransition(label = "paycraft_pulse_glow")

    val pulseAlpha by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = durationMillis, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "paycraft_pulse_alpha",
    )

    val glowScale by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.7f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = (durationMillis * 1.3f).toInt(), easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "paycraft_pulse_scale",
    )

    drawWithCache {
        val outline = shape.createOutline(size, layoutDirection, this)
        val currentColor = lerpColor(baseColor, glowColor, pulseAlpha)
        val highlightAlpha = pulseAlpha * 0.7f
        val glowBrush = Brush.radialGradient(
            colors = listOf(
                highlightColor.copy(alpha = highlightAlpha),
                currentColor,
                baseColor,
            ),
            center = Offset(size.width * glowScale, size.height * (1f - glowScale)),
            radius = maxOf(size.width, size.height) * 0.9f,
        )
        onDrawBehind {
            drawOutline(outline = outline, color = baseColor)
            drawOutline(outline = outline, brush = glowBrush)
        }
    }
}

/**
 * A shimmer [Brush] for callers that want to paint their own composables (a Canvas
 * layer, a custom Text placeholder). Reads [MaterialTheme.colorScheme] so it stays
 * host-theme-safe.
 *
 * @param reduceMotion When `true`, returns a static vertical gradient with no
 *                     animation (AC-14). The caller still paints a visible
 *                     placeholder — just no infinite tween.
 */
@Composable
fun rememberShimmerBrush(reduceMotion: Boolean = false): Brush {
    val baseColor = MaterialTheme.colorScheme.surfaceVariant
    val highlightColor = MaterialTheme.colorScheme.surface

    if (reduceMotion) {
        return Brush.verticalGradient(colors = listOf(baseColor, baseColor))
    }

    val transition = rememberInfiniteTransition(label = "paycraft_shimmer_brush")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "paycraft_shimmer_brush_pulse",
    )
    return Brush.verticalGradient(
        colors = listOf(
            lerpColor(baseColor, highlightColor, pulseAlpha),
            baseColor,
            lerpColor(baseColor, highlightColor, pulseAlpha * 0.5f),
        ),
    )
}

/**
 * Straight-line RGBA interpolation between two [Color] values — used by
 * [pulseGlow] and [rememberShimmerBrush] to blend base and highlight tones
 * driven by the animated fraction. Kept private to the shimmer module so it
 * cannot become a public utility API that changes without version bump.
 */
private fun lerpColor(start: Color, end: Color, fraction: Float): Color = Color(
    red = start.red + (end.red - start.red) * fraction,
    green = start.green + (end.green - start.green) * fraction,
    blue = start.blue + (end.blue - start.blue) * fraction,
    alpha = start.alpha + (end.alpha - start.alpha) * fraction,
)
