package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import com.mobilebytelabs.paycraft.generated.resources.Res
import com.mobilebytelabs.paycraft.generated.resources.paycraft_legal_privacy
import com.mobilebytelabs.paycraft.generated.resources.paycraft_legal_restore
import com.mobilebytelabs.paycraft.generated.resources.paycraft_legal_terms
import org.jetbrains.compose.resources.stringResource

/**
 * Minimal bottom row used at the foot of the paywall — matches the dashboard
 * Paywall designer's reference layout:
 *
 *           PRIVACY · TERMS · RESTORE
 *
 * Each label is a tap target. Privacy + Terms typically open hosted URLs;
 * Restore triggers the "I already paid" flow on the same screen. Callers
 * supply the action handlers — the SDK doesn't know which URLs the tenant
 * wants and can't surface a restore flow without consumer-side wiring.
 */
@Composable
fun PaywallLegalFooter(
    onPrivacyClick: () -> Unit,
    onTermsClick: () -> Unit,
    onRestoreClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LegalLink(
            label = stringResource(Res.string.paycraft_legal_privacy),
            onClick = onPrivacyClick,
        )
        LegalSeparator()
        LegalLink(
            label = stringResource(Res.string.paycraft_legal_terms),
            onClick = onTermsClick,
        )
        LegalSeparator()
        LegalLink(
            label = stringResource(Res.string.paycraft_legal_restore),
            onClick = onRestoreClick,
        )
    }
}

@Composable
private fun LegalLink(label: String, onClick: () -> Unit) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .clickable(onClick = onClick, role = Role.Button)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .semantics { contentDescription = label },
    )
}

@Composable
private fun LegalSeparator() {
    Text(
        text = "·",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.alpha(0.6f),
    )
}
