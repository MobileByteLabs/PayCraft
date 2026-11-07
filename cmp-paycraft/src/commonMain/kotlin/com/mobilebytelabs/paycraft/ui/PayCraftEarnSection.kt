package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.PayCraftAdRewards
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/**
 * Watch-to-earn, as one bindable surface.
 *
 * Renders NOTHING when the host bound no `adProvider` — an app that sells no ads gets no dead
 * button, and a host does not have to branch on availability itself. That is the same contract the
 * gates use: the surface decides whether it applies.
 *
 * The balance it shows afterwards is the RECONCILED one, not a locally added reward. The ad
 * network's signed callback decides the amount server-side, so a client-computed delta would be a
 * number the server overrules a moment later.
 */
@Composable
public fun PayCraftEarnSection(
    sku: String,
    modifier: Modifier = Modifier,
    title: String = "Watch an ad to earn",
    buttonLabel: String = "Watch",
) {
    val ads: PayCraftAdRewards = koinInject()
    if (!ads.isAvailable) return

    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }

    Column(
        modifier = modifier.fillMaxWidth().testTag(PayCraftTestTags.EARN_SECTION),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(text = title, style = MaterialTheme.typography.bodyMedium)
        Button(
            onClick = {
                // Guarded rather than disabled-only: a double tap mid-flight would show two ads and
                // credit one, which reads to the user as a reward that went missing.
                if (busy) return@Button
                busy = true
                scope.launch {
                    try {
                        ads.watchAndEarn(sku)
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy,
            modifier = Modifier.testTag(PayCraftTestTags.EARN_BUTTON),
        ) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp))
            } else {
                Text(buttonLabel)
            }
        }
    }
}
