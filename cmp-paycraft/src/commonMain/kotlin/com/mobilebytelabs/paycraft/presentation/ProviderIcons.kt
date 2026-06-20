package com.mobilebytelabs.paycraft.presentation

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * Inline-bundled brand-mark ImageVectors for the supported payment providers.
 *
 * SVG paths are the monochrome wordmarks from simpleicons.org (CC0), rendered
 * in each provider's brand color via [brandColorFor]. Embedding as ImageVector
 * keeps cmp-paycraft asset-free across all KMP targets — no compose-resources
 * dependency, no per-platform drawable folder, no asset-bundle size hit.
 *
 * The viewport is the standard simpleicons 24×24 grid.
 */

private fun providerVector(name: String, brand: Color, build: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(fill = SolidColor(brand), pathBuilder = build)
    }.build()

internal val StripeIcon: ImageVector by lazy {
    providerVector("stripe", Color(0xFF635BFF)) {
        // Wordmark "S" — simpleicons stripe.svg path
        moveTo(13.479f, 9.883f)
        curveToRelative(-1.626f, -0.604f, -2.512f, -1.067f, -2.512f, -1.803f)
        curveToRelative(0f, -0.622f, 0.511f, -0.977f, 1.423f, -0.977f)
        curveToRelative(1.667f, 0f, 3.379f, 0.642f, 4.558f, 1.22f)
        lineToRelative(0.666f, -4.111f)
        curveToRelative(-0.935f, -0.446f, -2.847f, -1.177f, -5.49f, -1.177f)
        curveToRelative(-1.87f, 0f, -3.425f, 0.489f, -4.536f, 1.401f)
        curveToRelative(-1.155f, 0.954f, -1.752f, 2.334f, -1.752f, 4.003f)
        curveToRelative(0f, 3.026f, 1.851f, 4.318f, 4.857f, 5.408f)
        curveToRelative(1.935f, 0.688f, 2.581f, 1.177f, 2.581f, 1.934f)
        curveToRelative(0f, 0.732f, -0.628f, 1.155f, -1.762f, 1.155f)
        curveToRelative(-1.402f, 0f, -3.696f, -0.689f, -5.195f, -1.578f)
        lineToRelative(-0.683f, 4.155f)
        curveTo(6.961f, 19.85f, 9.388f, 20.5f, 11.913f, 20.5f)
        curveToRelative(1.951f, 0f, 3.587f, -0.461f, 4.694f, -1.327f)
        curveToRelative(1.234f, -0.965f, 1.875f, -2.378f, 1.875f, -4.219f)
        curveToRelative(0f, -3.115f, -1.911f, -4.39f, -5.003f, -5.071f)
        close()
    }
}

internal val RazorpayIcon: ImageVector by lazy {
    providerVector("razorpay", Color(0xFF3395FF)) {
        // Two-piece "R" mark — simpleicons razorpay.svg path
        moveTo(22.436f, 0f)
        lineToRelative(-11.91f, 7.773f)
        lineToRelative(-1.174f, 4.276f)
        lineToRelative(6.625f, -4.297f)
        lineTo(11.65f, 24f)
        horizontalLineToRelative(4.391f)
        lineToRelative(6.395f, -24f)
        close()
        moveTo(14.26f, 10.098f)
        lineTo(3.389f, 17.166f)
        lineTo(1.564f, 24f)
        horizontalLineToRelative(9.008f)
        lineToRelative(3.688f, -13.902f)
        close()
    }
}

internal val PayPalIcon: ImageVector by lazy {
    providerVector("paypal", Color(0xFF003087)) {
        // PayPal wordmark "P" — simpleicons paypal.svg path
        moveTo(20.067f, 8.478f)
        curveToRelative(0.492f, 0.315f, 0.844f, 0.825f, 0.918f, 1.546f)
        curveToRelative(0.008f, 0.075f, 0.014f, 0.156f, 0.016f, 0.241f)
        curveToRelative(0.003f, 0.245f, -0.025f, 0.509f, -0.083f, 0.793f)
        curveToRelative(-0.787f, 3.74f, -3.331f, 6.06f, -7.358f, 6.06f)
        horizontalLineToRelative(-0.94f)
        curveToRelative(-0.495f, 0f, -0.91f, 0.358f, -0.985f, 0.84f)
        lineToRelative(-0.04f, 0.214f)
        lineToRelative(-0.81f, 5.156f)
        lineToRelative(-0.054f, 0.354f)
        curveToRelative(-0.076f, 0.483f, -0.49f, 0.84f, -0.984f, 0.84f)
        horizontalLineToRelative(-3.62f)
        curveToRelative(-0.275f, 0f, -0.527f, -0.106f, -0.711f, -0.297f)
        curveToRelative(-0.183f, -0.192f, -0.275f, -0.452f, -0.245f, -0.713f)
        curveToRelative(0.018f, -0.151f, 0.05f, -0.341f, 0.097f, -0.566f)
        lineTo(7.04f, 2.567f)
        curveTo(7.137f, 2.072f, 7.575f, 1.711f, 8.077f, 1.711f)
        horizontalLineToRelative(7.46f)
        curveToRelative(2.117f, 0f, 3.78f, 0.55f, 4.81f, 1.582f)
        curveToRelative(0.65f, 0.654f, 1.067f, 1.448f, 1.225f, 2.345f)
        curveToRelative(0.073f, 0.41f, 0.106f, 0.846f, 0.097f, 1.298f)
        curveToRelative(-0.001f, 0.027f, -0.001f, 0.055f, -0.003f, 0.085f)
        curveToRelative(-0.003f, 0.31f, -0.025f, 0.626f, -0.067f, 0.953f)
        curveToRelative(-0.467f, 3.668f, -2.81f, 5.97f, -6.87f, 5.97f)
        horizontalLineToRelative(-1.045f)
        curveToRelative(-0.494f, 0f, -0.91f, 0.357f, -0.985f, 0.84f)
        close()
    }
}

/** Returns the brand ImageVector for the provider key, or null if no icon is bundled. */
internal fun providerIconFor(providerKey: String): ImageVector? = when (providerKey) {
    "stripe" -> StripeIcon
    "razorpay" -> RazorpayIcon
    "paypal" -> PayPalIcon
    else -> null
}
