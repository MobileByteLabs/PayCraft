package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.InitOptions
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A DEBUG build must never address the LIVE billing environment — including before `/config` lands.
 *
 * THE INCIDENT (mbs/cappy on a physical OnePlus CPH2423, 2026-10-09). `stripeMode` read
 *
 *     if ((PayCraft.config?.provider as? StripeProvider)?.isTestMode == true) "test" else "live"
 *
 * so it answered "live" whenever the question could not be answered — and at startup it cannot,
 * because `PayCraft.config` is null until the cloud fetch returns. On device:
 *
 *     16:14:14.426  [initialize]  build = Debug (android:debug-keystore-signature)
 *     16:14:14.481  [init]        stripeMode=live        <- 55 ms later, config still null
 *     16:14:15.409  [loadConfig]  apiKey=pk_test_…  mode=Test
 *
 * The paywall came from TEST while `register_device(mode=live)` WROTE a device row into LIVE and
 * entitlements were read from LIVE. This is the F35 shape — default to live when undetermined —
 * recurring in the one place that never consulted BuildKind.
 *
 * WHY THESE ASSERTIONS AND NOT A BEHAVIOURAL ONE. The route from a public call to the mode string
 * (`logIn` -> performRegisterAndLogin -> service.registerDevice) first reads `DeviceTokenStore`,
 * the filesystem/Keychain `expect object` that PayCraftBillingManagerTest documents as impossible
 * to drive deterministically from commonTest. Asserting the resolved string keeps the rule guarded
 * rather than leaving it to a test that cannot run. `modeOverride` is the deterministic lever —
 * it removes the platform build-kind probe from the equation entirely.
 */
class StripeModeAuthorityTest {

    /** Only the abstract members; the interface defaults cover the rest. */
    private class StubService : PayCraftService {
        override suspend fun isPremium(serverToken: String) = false
        override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
        override suspend fun isTrialEligible(serverToken: String) = true
        override suspend fun registerDevice(
            email: String,
            platform: String,
            deviceName: String,
            deviceId: String,
            mode: String,
        ) = RegisterDeviceResult(
            deviceToken = "tok",
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
        override suspend fun checkPremiumWithDevice(serverToken: String) =
            PremiumCheckResult(isPremium = false, tokenValid = true)
        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String) = true
        override suspend fun revokeDevice(serverToken: String, targetToken: String) = true
        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
    }

    private class StubStore : PayCraftStore {
        private var email: String? = null
        override suspend fun saveEmail(email: String) { this.email = email }
        override suspend fun getEmail(): String? = email
        override suspend fun clearEmail() { email = null }
    }

    private fun manager() = PayCraftBillingManager(service = StubService(), store = StubStore())

    /** Initialize WITHOUT resolving a config, so `PayCraft.config` is null exactly as at startup. */
    private fun initUnresolved(mode: PayCraft.Mode) {
        PayCraft.initialize(
            apiKey = "pk_test_authority",
            backend = PayCraftBackend.Cloud,
            options = InitOptions(modeOverride = mode),
        )
    }

    @Test
    fun debug_build_with_unresolved_config_resolves_test_not_live() {
        // THE REGRESSION. Before the fix this returned "live".
        initUnresolved(PayCraft.Mode.Test)
        assertEquals(
            "test",
            manager().stripeMode,
            "a Test-mode build must address the test environment even before /config lands — " +
                "returning \"live\" here is what wrote a debug device row into live billing",
        )
    }

    @Test
    fun live_build_resolves_live() {
        // The fix must not defang the real case: a genuine Live verdict still reaches live.
        initUnresolved(PayCraft.Mode.Live)
        assertEquals("live", manager().stripeMode)
    }

    @Test
    fun unknown_mode_never_guesses_live() {
        // No positive Live verdict => no live money. Silence must not resolve to the costly side.
        initUnresolved(PayCraft.Mode.Unknown)
        assertEquals(
            "test",
            manager().stripeMode,
            "an indeterminate mode must not default to the environment that can take real money",
        )
    }

    @Test
    fun resolution_is_stable_across_repeated_reads() {
        // `stripeMode` is a getter read on several paths (register, premium check). All of them
        // must agree; the original bug was precisely that the answer changed once config arrived,
        // so early callers and late callers addressed different environments.
        initUnresolved(PayCraft.Mode.Test)
        val m = manager()
        assertEquals(m.stripeMode, m.stripeMode)
        assertEquals("test", m.stripeMode)
    }
}
