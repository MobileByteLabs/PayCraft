/*
 * PayCraft SDK — bundled Lottie state animations.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import io.github.alexzhirkevich.compottie.Compottie
import io.github.alexzhirkevich.compottie.LottieCompositionSpec
import io.github.alexzhirkevich.compottie.animateLottieCompositionAsState
import io.github.alexzhirkevich.compottie.rememberLottieComposition
import io.github.alexzhirkevich.compottie.rememberLottiePainter
import org.jetbrains.compose.resources.ExperimentalResourceApi
import androidx.compose.foundation.Image

/**
 * Which bundled animation a terminal state shows.
 *
 * Deliberately small: these are the two situations where the SDK has nothing purchasable to render,
 * and they call for different motion — "we can't reach you" reads differently from "we reached the
 * server and it answered wrong".
 */
enum class PayCraftStateAnimationKind(internal val path: String) {
    /** Signal arcs fading out under a drawn-on slash — the user's connection is the suspect. */
    Offline("files/paycraft/offline.json"),

    /** A card tilting under a scanning pulse — we are looking, and it is our side that is wrong. */
    ConfigError("files/paycraft/config_error.json"),
}

/**
 * A looping Lottie animation bundled inside the SDK.
 *
 * ## Why a Lottie and not an Icon
 * These animations appear on screens the user reaches when billing is ALREADY broken. A static grey
 * glyph above two lines of text reads as a crash screen; motion reads as a product that knows what
 * state it is in. It is the cheapest available signal that someone designed this path.
 *
 * ## Why it is tinted, not coloured
 * The JSON is authored monochrome and re-tinted here to [PayCraftTheme]'s `onSurfaceVariant`, so it
 * sits correctly on whatever surface a tenant's dashboard theme provides — including dark. Baking
 * brand colour into the asset would make it wrong on half of them.
 *
 * ## Failure behaviour
 * If the composition fails to load the slot renders EMPTY rather than throwing: this is the error
 * screen, and an error screen that can itself crash is worse than one with no picture. The surrounding
 * title / body / actions are unaffected.
 */
@OptIn(ExperimentalResourceApi::class)
@Composable
fun PayCraftStateAnimation(
    kind: PayCraftStateAnimationKind,
    modifier: Modifier = Modifier,
    size: Dp = 148.dp,
) {
    var json by remember(kind) { mutableStateOf<String?>(null) }
    LaunchedEffect(kind) {
        json = runCatching { Res.readBytes(kind.path).decodeToString() }.getOrNull()
    }

    val payload = json ?: return
    val composition by rememberLottieComposition { LottieCompositionSpec.JsonString(payload) }
    val progress by animateLottieCompositionAsState(
        composition = composition,
        iterations = Compottie.IterateForever,
    )

    Image(
        painter = rememberLottiePainter(composition = composition, progress = { progress }),
        contentDescription = null,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(PayCraftTheme.colors.onSurfaceVariant),
    )
}
