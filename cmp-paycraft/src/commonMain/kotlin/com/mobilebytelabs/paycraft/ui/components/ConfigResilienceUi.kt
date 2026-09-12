/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The two surfaces the resilience chain needs above the paywall template: a terminal
 * "config unavailable" state, and a staleness notice for data served from an expired cache.
 * Both replace situations that previously rendered an indefinite skeleton.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import org.jetbrains.compose.resources.stringResource
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_age_days
import com.mobilebytelabs.paycraft.generated.resources.paycraft_age_hours
import com.mobilebytelabs.paycraft.generated.resources.paycraft_age_minutes
import com.mobilebytelabs.paycraft.generated.resources.paycraft_age_moments
import com.mobilebytelabs.paycraft.generated.resources.paycraft_age_yesterday
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_decode_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_decode_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_generic_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_http_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_not_initialized_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_config_failed_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_no_plans_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_no_plans_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_offline_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_offline_title
import com.mobilebytelabs.paycraft.generated.resources.paycraft_close
import com.mobilebytelabs.paycraft.generated.resources.paycraft_retry
import com.mobilebytelabs.paycraft.generated.resources.paycraft_stale_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_stale_refresh
import com.mobilebytelabs.paycraft.config.ConfigResult

/**
 * Terminal state: every resilience layer failed and there is nothing purchasable to show.
 *
 * The wording is chosen per reason, because "check your connection" is actively unhelpful when the
 * user's connection is fine and the fault is ours. Retry is offered only when the failure could
 * plausibly clear on its own — a decode error will not.
 *
 * ## Why there is always exactly one action
 * A non-retryable failure used to render title + body and NOTHING else: a dead end the user could
 * only escape with the system back gesture. That reads as a hang, not a decision. Retry stays gated
 * on [ConfigResult.isRetryable] — offering a button that cannot work is a dead clickable dressed as
 * help — so the non-retryable path gets [onDismiss] instead, which always works. Never zero actions.
 *
 * ## Why there is an animation
 * This screen is reached when billing is already broken. A looping Lottie costs ~6 KB and is the
 * cheapest signal that this path was designed rather than fallen into; a bare line of grey text on a
 * blank surface is indistinguishable from a crash.
 *
 * @param onDismiss closes the paywall. Optional only so existing callers compile; when absent, a
 *   non-retryable failure falls back to the previous no-action rendering.
 */
@Composable
fun ConfigUnavailable(
    result: ConfigResult,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onDismiss: (() -> Unit)? = null,
) {
    // Localised, not literal. These strings existed in strings.xml from the moment this surface was
    // written — added for the AC-28 pairing — and the composable carried English literals anyway,
    // which breaks every non-English deployment of the SDK.
    val title: String
    val body: String
    when ((result as? ConfigResult.Failed)?.reason) {
        ConfigResult.Failed.Reason.OFFLINE -> {
            title = stringResource(Res.string.paycraft_offline_title)
            body = stringResource(Res.string.paycraft_offline_body)
        }
        ConfigResult.Failed.Reason.HTTP_ERROR -> {
            title = stringResource(Res.string.paycraft_config_failed_title)
            body = stringResource(Res.string.paycraft_config_failed_http_body)
        }
        ConfigResult.Failed.Reason.DECODE_ERROR -> {
            title = stringResource(Res.string.paycraft_config_failed_decode_title)
            body = stringResource(Res.string.paycraft_config_failed_decode_body)
        }
        ConfigResult.Failed.Reason.NOT_INITIALIZED -> {
            title = stringResource(Res.string.paycraft_config_failed_title)
            body = stringResource(Res.string.paycraft_config_failed_not_initialized_body)
        }
        else -> {
            title = stringResource(Res.string.paycraft_config_failed_title)
            body = stringResource(Res.string.paycraft_config_failed_generic_body)
        }
    }

    val reason = (result as? ConfigResult.Failed)?.reason

    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Offline gets its own motion: "we can't reach you" and "the server answered wrong" are
        // different problems, and the picture should not claim the user's connection is at fault.
        PayCraftStateAnimation(
            kind = if (reason == ConfigResult.Failed.Reason.OFFLINE) {
                PayCraftStateAnimationKind.Offline
            } else {
                PayCraftStateAnimationKind.ConfigError
            },
        )
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            // Tagged per-reason so AC-28 can pair the offline and http-error goldens separately —
            // they differ only in wording, and the wording is the whole product decision.
            modifier = Modifier.testTag(
                if (reason == ConfigResult.Failed.Reason.OFFLINE) {
                    PayCraftTestTags.OFFLINE_MESSAGE
                } else {
                    PayCraftTestTags.CONFIG_FAILED_MESSAGE
                },
            ),
        )
        Spacer(Modifier.height(4.dp))
        when {
            result.isRetryable -> Button(
                onClick = onRetry,
                shape = RoundedCornerShape(26.dp),
                contentPadding = ButtonDefaults.ContentPadding,
                modifier = Modifier.testTag(PayCraftTestTags.CONFIG_FAILED_RETRY),
            ) { Text(stringResource(Res.string.paycraft_retry)) }

            // Not retryable, but never a dead end — this button always does something real.
            onDismiss != null -> OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(26.dp),
                modifier = Modifier.testTag(PayCraftTestTags.CONFIG_FAILED_DISMISS),
            ) { Text(stringResource(Res.string.paycraft_close)) }
        }
    }
}

/**
 * Config loaded, but this tenant has NO active products to sell.
 *
 * A separate state from [ConfigUnavailable] because nothing failed: the dashboard simply has no
 * published plans yet (a new tenant, or store products not yet live). Routing this through the error
 * surface would tell the user "Something went wrong" about a perfectly healthy app, and would send
 * them retrying a request that is already succeeding.
 *
 * There is no Retry for the same reason — the fix is on the tenant's side, not the user's. The only
 * honest action is to leave.
 */
@Composable
fun PlansUnavailable(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PayCraftStateAnimation(kind = PayCraftStateAnimationKind.ConfigError)
        Text(
            text = stringResource(Res.string.paycraft_no_plans_title),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(Res.string.paycraft_no_plans_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(PayCraftTestTags.NO_PLANS_MESSAGE),
        )
        Spacer(Modifier.height(4.dp))
        OutlinedButton(
            onClick = onDismiss,
            shape = RoundedCornerShape(26.dp),
            modifier = Modifier.testTag(PayCraftTestTags.NO_PLANS_DISMISS),
        ) { Text(stringResource(Res.string.paycraft_close)) }
    }
}

/**
 * Shown above the paywall when the rendered prices came from an EXPIRED cache.
 *
 * Non-blocking on purpose: the prices are probably still right, and hiding a usable paywall behind
 * a warning would trade one bad outcome for another. The user is told, and can refresh.
 */
@Composable
fun StaleConfigNotice(
    ageSeconds: Long,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(Res.string.paycraft_stale_body, humanizeAge(ageSeconds)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f).testTag(PayCraftTestTags.STALE_MESSAGE),
            )
            Text(
                text = stringResource(Res.string.paycraft_stale_refresh),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable(onClick = onRetry).testTag(PayCraftTestTags.STALE_REFRESH),
            )
        }
    }
}

/**
 * Rounded, human-scale age. Precision here is noise — "3 days ago" is the whole message.
 *
 * Each unit is its own resource rather than an English suffix concatenated onto a number, so a
 * translator can render the whole phrase naturally instead of receiving " min ago" to glue on.
 */
@Composable
internal fun humanizeAge(seconds: Long): String = when {
    seconds < 60 -> stringResource(Res.string.paycraft_age_moments)
    seconds < 3_600 -> stringResource(Res.string.paycraft_age_minutes, (seconds / 60).toInt())
    seconds < 86_400 -> stringResource(Res.string.paycraft_age_hours, (seconds / 3_600).toInt())
    seconds < 172_800 -> stringResource(Res.string.paycraft_age_yesterday)
    else -> stringResource(Res.string.paycraft_age_days, (seconds / 86_400).toInt())
}
