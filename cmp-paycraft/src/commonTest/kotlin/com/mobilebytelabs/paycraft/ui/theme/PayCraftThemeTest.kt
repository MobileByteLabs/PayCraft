package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.v2.runComposeUiTest
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * G-1 (AC-2 + AC-3) verifier for the unified [PayCraftThemeProvider].
 *
 * Locks the "config-wins-else-host-inherit" precedence contract:
 *
 * - AC-2 — when [SuiteConfig.themeOverride] is null (no cloud theme configured),
 *   the resolved [MaterialTheme.colorScheme.primary] MUST equal the host scheme's
 *   primary (host-inherit).
 * - AC-3 — when [SuiteConfig.themeOverride] carries a branded `primary`, the
 *   resolved [MaterialTheme.colorScheme.primary] MUST equal that branded color
 *   regardless of the (contrasting) host scheme (config-wins).
 *
 * Assertion strategy: a probe composable captures the resolved primary color out
 * to an in-test var during composition; `runComposeUiTest` runs composition
 * synchronously so the captured value is set before the outer assertion — no
 * invented `assertBackgroundColor` API, no snapshot-flow gymnastics.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftThemeTest {

    private val hostAccent = Color(0xFF123456)
    private val brandedAccent = Color(0xFF00AA55)
    private val contrastingHostAccent = Color(0xFFFF0000)

    @Test
    fun paywall_inherits_host_scheme_when_config_null() = runComposeUiTest {
        val hostScheme = lightColorScheme(primary = hostAccent)
        var resolved: Color? = null

        setContent {
            MaterialTheme(colorScheme = hostScheme) {
                PayCraftThemeProvider(config = null) {
                    // Read from within the composition — this is the same
                    // MaterialTheme every PayCraft downstream composable sees.
                    resolved = MaterialTheme.colorScheme.primary
                }
            }
        }
        waitForIdle()

        assertNotNull(resolved, "PayCraftThemeProvider probe never composed")
        assertEquals(
            expected = hostAccent,
            actual = resolved,
            message = "Host-inherit (AC-2) violated: PayCraftThemeProvider replaced the host " +
                "primary when no cloud theme override was configured.",
        )
    }

    @Test
    fun paywall_config_wins_over_contrasting_host_scheme() = runComposeUiTest {
        val contrastingHost = lightColorScheme(primary = contrastingHostAccent)
        // Dashboard-configured brand primary encoded as `#00AA55` (matches
        // `brandedAccent = Color(0xFF00AA55)` once parsed via parseHexColor).
        val brandedConfig = SuiteConfig(
            tenantId = "test-tenant",
            paywall = PaywallDto(primaryColor = "#00AA55"),
        )
        var resolved: Color? = null

        setContent {
            MaterialTheme(colorScheme = contrastingHost) {
                PayCraftThemeProvider(config = brandedConfig) {
                    resolved = MaterialTheme.colorScheme.primary
                }
            }
        }
        waitForIdle()

        assertNotNull(resolved, "PayCraftThemeProvider probe never composed")
        assertEquals(
            expected = brandedAccent,
            actual = resolved,
            message = "Config-wins (AC-3) violated: cloud brand primary #00AA55 was not " +
                "applied over contrasting host primary #FF0000.",
        )
    }
}
