package com.mobilebytelabs.paycraft.ui.survey

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_survey_back
import com.mobilebytelabs.paycraft.generated.resources.paycraft_survey_other_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_survey_send
import com.mobilebytelabs.paycraft.generated.resources.paycraft_survey_skip
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_badge
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_claim
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_decline
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_ends_in
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_forever
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_months
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_note
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_once
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_plan
import com.mobilebytelabs.paycraft.generated.resources.paycraft_winback_title
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme
import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import com.mobilebytelabs.paycraft.winback.WinbackOffer
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource
import kotlin.time.Clock
import kotlin.time.Instant

/**
 * "Before you go — what stopped you?" (paycraft-paywall-analytics, GOAL D6). Shown in place of the paywall body —
 * the same sheet, never a second one — when a buyer closes without buying. One tap answers; the reason that
 * asks for free text expands a field and a Send button. The question and reasons are the tenant's.
 */
@Composable
internal fun ExitSurveyContent(
    cfg: ExitSurveyConfig,
    sending: Boolean,
    onAnswer: (code: String, freeText: String?) -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    var expanded by rememberSaveable { mutableStateOf<String?>(null) }
    var text by rememberSaveable { mutableStateOf("") }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp)
            .testTag(PayCraftTestTags.EXIT_SURVEY),
    ) {
        Text(cfg.title, color = colors.onSurface, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(20.dp))
        val shape = RoundedCornerShape(14.dp)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            cfg.reasons.forEach { r ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .border(1.dp, if (expanded == r.code) colors.accent else colors.divider, shape)
                        .clickable(enabled = !sending) {
                            if (r.freeText) expanded = r.code else onAnswer(r.code, null)
                        }
                        .padding(horizontal = 16.dp, vertical = 14.dp)
                        .testTag(PayCraftTestTags.exitReason(r.code)),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            r.label,
                            color = colors.onSurface,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.onSurfaceVariant,
                        )
                    }
                    if (expanded == r.code) {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = text,
                            onValueChange = { text = it.take(500) },
                            placeholder = { Text(stringResource(Res.string.paycraft_survey_other_hint)) },
                            modifier = Modifier.fillMaxWidth().heightIn(
                                min = 88.dp,
                            ).testTag(PayCraftTestTags.EXIT_SURVEY_OTHER_FIELD),
                        )
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = { onAnswer(r.code, text.ifBlank { null }) },
                            enabled = !sending,
                            modifier = Modifier.align(Alignment.End).testTag(PayCraftTestTags.EXIT_SURVEY_SEND),
                        ) { Text(stringResource(Res.string.paycraft_survey_send)) }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (sending) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            } else {
                TextButton(onClick = onSkip, modifier = Modifier.testTag(PayCraftTestTags.EXIT_SURVEY_SKIP)) {
                    Text(stringResource(Res.string.paycraft_survey_skip), color = colors.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * The win-back offer the buyer's answer earned: the discount up front, what it applies to and for how long,
 * one primary "Claim" that goes straight to checkout with the offer applied, and a quiet "No thanks".
 */
@Composable
internal fun WinbackOfferContent(
    offer: WinbackOffer,
    plan: BillingPlan?,
    onClaim: () -> Unit,
    onDecline: () -> Unit,
    modifier: Modifier = Modifier,
    now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    val colors = PayCraftTheme.colors
    var left by remember(offer.expiresAtIso) { mutableStateOf(offerTimeLeft(offer.expiresAtIso, now())) }
    LaunchedEffect(offer.expiresAtIso) {
        while (left != null) {
            delay(30_000)
            left = offerTimeLeft(offer.expiresAtIso, now())
        }
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 28.dp)
            .testTag(PayCraftTestTags.WINBACK_OFFER),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(colors.accent.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.LocalOffer,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(30.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(Res.string.paycraft_winback_badge, offer.percentOff),
            color = colors.accent,
            fontSize = 34.sp,
            fontWeight = FontWeight.ExtraBold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            stringResource(Res.string.paycraft_winback_title),
            color = colors.onSurface,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        val months = offer.durationInMonths
        val duration = when {
            offer.duration == "forever" -> stringResource(Res.string.paycraft_winback_forever, offer.percentOff)
            offer.duration == "repeating" && months != null ->
                stringResource(Res.string.paycraft_winback_months, offer.percentOff, months)
            else -> stringResource(Res.string.paycraft_winback_once, offer.percentOff)
        }
        Text(duration, color = colors.onSurfaceVariant, fontSize = 15.sp, textAlign = TextAlign.Center)
        if (plan != null) {
            Spacer(Modifier.height(4.dp))
            val after = discountedPrice(plan.price, offer.percentOff)
            Text(
                buildAnnotatedString {
                    append(stringResource(Res.string.paycraft_winback_plan, plan.name, ""))
                    if (after == null) {
                        append(plan.price)
                    } else {
                        withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(plan.price) }
                        append(" ")
                        withStyle(SpanStyle(color = colors.onSurface, fontWeight = FontWeight.Bold)) { append(after) }
                    }
                },
                color = colors.onSurfaceVariant,
                fontSize = 14.sp,
            )
        }
        left?.let {
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(Res.string.paycraft_winback_ends_in, it),
                color = colors.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onClaim,
            colors = ButtonDefaults.buttonColors(containerColor = colors.accent),
            shape = RoundedCornerShape(999.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag(PayCraftTestTags.WINBACK_CLAIM),
        ) {
            Text(
                stringResource(Res.string.paycraft_winback_claim, offer.percentOff),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.height(6.dp))
        TextButton(onClick = onDecline, modifier = Modifier.testTag(PayCraftTestTags.WINBACK_DECLINE)) {
            Text(stringResource(Res.string.paycraft_winback_decline), color = colors.onSurfaceVariant)
        }
        Spacer(Modifier.width(4.dp))
        Text(
            stringResource(Res.string.paycraft_winback_note),
            color = colors.onSurfaceVariant,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * [price] (as the store/config formatted it — "₹299", "$9.99", "₹1,499") with [percentOff] taken off, in the
 * same format: currency text kept, grouping kept, the original's decimals kept (two when a whole price halves
 * to a fraction, so "$9" → "$4.50", never a rounded "$5" the buyer is not charged). Null when no number is found.
 */
internal fun discountedPrice(price: String, percentOff: Int): String? {
    val m = PRICE_NUMBER.find(price) ?: return null
    val whole = m.groupValues[1]
    val fraction = m.groupValues[2]
    val value = (whole.replace(",", "") + fraction).toDoubleOrNull() ?: return null
    val off = value * (100 - percentOff.coerceIn(0, 100)) / 100.0
    val decimals = when {
        fraction.isNotEmpty() -> fraction.length - 1
        off == kotlin.math.floor(off) -> 0
        else -> 2
    }
    var scale = 1L
    repeat(decimals) { scale *= 10 }
    val scaled = kotlin.math.round(off * scale).toLong()
    val intPart = (scaled / scale).toString()
    val grouped = if (whole.contains(',')) intPart.reversed().chunked(3).joinToString(",").reversed() else intPart
    val text = if (decimals == 0) grouped else "$grouped.${(scaled % scale).toString().padStart(decimals, '0')}"
    return price.replaceRange(m.range, text)
}

private val PRICE_NUMBER = Regex("""(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?""")

/** "47:59" (hours:minutes) until [expiresAtIso]; "3d" past 99 hours; null once expired or unparseable. */
internal fun offerTimeLeft(expiresAtIso: String, nowMillis: Long): String? {
    val end = runCatching { Instant.parse(expiresAtIso) }.getOrNull()?.toEpochMilliseconds() ?: return null
    val minutes = (end - nowMillis) / 60_000
    if (minutes <= 0) return null
    val hours = minutes / 60
    return if (hours > 99) "${hours / 24}d" else "$hours:${(minutes % 60).toString().padStart(2, '0')}"
}

/** The tenant's message for a reason (e.g. "We also accept UPI on our website") with a way back to the plans. */
@Composable
internal fun ExitSurveyMessageContent(
    message: String,
    onBack: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PayCraftTheme.colors
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp).testTag(PayCraftTestTags.EXIT_SURVEY_MESSAGE),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = colors.onSurface, fontSize = 17.sp, lineHeight = 24.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onBack,
            shape = RoundedCornerShape(999.dp),
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag(PayCraftTestTags.EXIT_SURVEY_BACK),
        ) {
            Text(stringResource(Res.string.paycraft_survey_back))
        }
        TextButton(onClick = onClose) {
            Text(stringResource(Res.string.paycraft_survey_skip), color = colors.onSurfaceVariant)
        }
    }
}
