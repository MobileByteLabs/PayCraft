package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_apple
import com.mobilebytelabs.paycraft.generated.resources.paycraft_device_conflict_gate_oauth_google
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_body
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_done
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_hint
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_not_now
import com.mobilebytelabs.paycraft.generated.resources.paycraft_link_title
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.ui.components.rememberPayCraftSignIn
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

/**
 * Wraps a paywall so a STORE purchase made without an identity is followed — once — by the
 * optional, full-screen [PayCraftLinkAccountScreen] before [onFinished] (PLAN-paycraft-native-
 * identity D4). Never shown before a purchase, never blocking it (Apple 5.1.1).
 *
 * "Just purchased" is premium now but not on entry: a subscriber who opens the paywall to look at
 * plans is not prompted. A purchase that already carries an identity (an email from web checkout or
 * an earlier sign-in) is linked already, so the prompt is skipped.
 *
 * @param onFinished called once the purchase is complete and the prompt (if any) is done.
 */
@Composable
internal fun PostPurchaseLinkGate(onFinished: () -> Unit, paywall: @Composable () -> Unit) {
    val billing = koinInject<BillingManager>()
    val store = koinInject<PayCraftStore>()
    val isPremium by billing.isPremium.collectAsState()
    val email by billing.userEmail.collectAsState()
    val premiumOnEntry = remember { isPremium }
    var linking by remember { mutableStateOf(false) }

    LaunchedEffect(isPremium) {
        if (!isPremium || premiumOnEntry) return@LaunchedEffect
        if (email == null && !store.isLinkPromptShown()) {
            store.markLinkPromptShown()
            linking = true
        } else {
            onFinished()
        }
    }

    if (linking) PayCraftLinkAccountScreen(onDone = onFinished) else paywall()
}

/**
 * "Keep your subscription on all your devices" — native Apple / Google sign-in, always skippable.
 *
 * Signing in identifies the buyer (the billing manager observes PayCraft's session), which re-links
 * the store purchase to that account so it restores on the other platform. The screen closes itself
 * shortly after the link lands, showing which account it went to.
 */
@Composable
internal fun PayCraftLinkAccountScreen(onDone: () -> Unit, modifier: Modifier = Modifier) {
    val signIn = rememberPayCraftSignIn()
    val email by koinInject<BillingManager>().userEmail.collectAsState()

    LaunchedEffect(email) {
        if (email != null) {
            delay(1_500)
            onDone()
        }
    }

    Surface(modifier = modifier.fillMaxSize().testTag(PayCraftTestTags.LINK_ACCOUNT_SCREEN)) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(Res.string.paycraft_link_title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
            )
            val linked = email
            if (linked != null) {
                Text(
                    text = stringResource(Res.string.paycraft_link_done, linked),
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.testTag(PayCraftTestTags.LINK_ACCOUNT_DONE),
                )
                return@Column
            }
            Text(
                text = stringResource(Res.string.paycraft_link_body),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(Res.string.paycraft_link_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))
            if (signIn != null && OAuthProvider.APPLE in signIn.providers) {
                Button(
                    onClick = { signIn.launch(OAuthProvider.APPLE) },
                    modifier = Modifier.fillMaxWidth().testTag(PayCraftTestTags.LINK_ACCOUNT_APPLE),
                ) { Text(stringResource(Res.string.paycraft_device_conflict_gate_oauth_apple)) }
            }
            if (signIn != null && OAuthProvider.GOOGLE in signIn.providers) {
                OutlinedButton(
                    onClick = { signIn.launch(OAuthProvider.GOOGLE) },
                    modifier = Modifier.fillMaxWidth().testTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE),
                ) { Text(stringResource(Res.string.paycraft_device_conflict_gate_oauth_google)) }
            }
            TextButton(
                onClick = onDone,
                modifier = Modifier.testTag(PayCraftTestTags.LINK_ACCOUNT_NOT_NOW),
            ) { Text(stringResource(Res.string.paycraft_link_not_now)) }
        }
    }
}
