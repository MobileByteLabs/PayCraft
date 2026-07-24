package com.mobilebytelabs.paycraft.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import kotlinx.coroutines.runBlocking
import org.koin.core.context.GlobalContext

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // E6 device-verify harness (sub-plan 06, AC8). A maestro `launchApp.arguments`
        // pair — `paycraft_provider` + `paycraft_user_id` — seeds a provider-specific
        // Premium entitlement into the REAL PayCraftStore cache BEFORE Koin materializes
        // the BillingManager. On first composition, PayCraftBillingManager.init reads that
        // cache synchronously (applyCachedStatus -> BillingState.Premium) — i.e. the flows
        // exercise the genuine cache-first, offline last-known-good gating path (D6/D8),
        // NOT a stub. Fires ONLY when the extras are present (under maestro); a normal
        // launcher tap leaves the app at its Mock/Free showcase state, untouched.
        maybeSeedEntitlementFromLaunchArgs()
        enableEdgeToEdge()
        setContent {
            // Expose Compose testTags as Android resource-ids so maestro's `id:` selector
            // resolves the debug-panel + banner testTags (billing_state_label, billing_provider,
            // paycraft_banner_manage_button, …). Without this, Compose testTags never surface in
            // the accessibility hierarchy maestro reads.
            Box(modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
                App()
            }
        }
    }

    private fun maybeSeedEntitlementFromLaunchArgs() {
        val provider = intent?.getStringExtra("paycraft_provider") ?: return
        val userId = intent?.getStringExtra("paycraft_user_id") ?: "e2e-$provider-01"
        val store = GlobalContext.getOrNull()?.get<PayCraftStore>() ?: return
        // Email must be present too, or PayCraftBillingManager.init's async branch
        // overwrites the cached Premium with Free (no-saved-email -> Free).
        runBlocking { store.saveEmail(userId) }
        store.cacheSubscriptionStatus(
            SubscriptionStatus(
                isPremium = true,
                plan = "yearly",
                email = userId,
                provider = provider,
                expiresAt = "2099-12-31T00:00:00Z",
                willRenew = true,
            ),
        )
    }
}
