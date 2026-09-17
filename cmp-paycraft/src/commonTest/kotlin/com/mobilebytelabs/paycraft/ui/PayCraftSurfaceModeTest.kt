package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Regression tests for the "paywall goes blank behind the sheet" bug (UI-1 / UI-2).
 *
 * The defect: a paywall hosted inside a `ModalBottomSheet` declared `fillMaxSize()` and painted an
 * opaque background, so it expanded the sheet to the full window and covered the sheet's scrim —
 * the host app behind it vanished and the sheet read as an opaque full-screen takeover.
 *
 * These tests pin the contract that fixes it: in [PayCraftSurfaceMode.Sheet] the paywall wraps its
 * content height (so the container, not the paywall, decides how tall the sheet is), and in
 * [PayCraftSurfaceMode.FullScreen] it still fills the window as before.
 *
 * Layout bounds are the assertion rather than a pixel snapshot because the failure mode IS a layout
 * one — an opaque full-bleed fill — and bounds make it deterministic across render backends.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftSurfaceModeTest {

    private val hostHeight = 300.dp
    private val contentHeight = 80.dp
    private val rootTag = "surface_mode_root"
    private val hostTag = "surface_mode_host"

    /** A stand-in for a template root: exactly what every PaywallTemplate now declares. */
    private fun content(): @Composable () -> Unit = {
        Box(
            Modifier
                .paywallRoot(Color.Red)
                .testTag(rootTag),
        ) {
            Box(Modifier.height(contentHeight))
        }
    }

    @Test
    fun fullScreenMode_fillsTheHost() = runComposeUiTest {
        setContent {
            Box(Modifier.size(400.dp, hostHeight).testTag(hostTag)) {
                CompositionLocalProvider(
                    LocalPayCraftSurfaceMode provides PayCraftSurfaceMode.FullScreen,
                ) { content()() }
            }
        }

        val host = onNodeWithTag(hostTag).getUnclippedBoundsInRoot().height
        val height = onNodeWithTag(rootTag).getUnclippedBoundsInRoot().height
        assertEquals(
            host,
            height,
            "FullScreen mode must fill the host window — it owns the surface.",
        )
    }

    @Test
    fun sheetMode_wrapsContentSoTheContainerKeepsItsScrim() = runComposeUiTest {
        setContent {
            Box(Modifier.size(400.dp, hostHeight).testTag(hostTag)) {
                CompositionLocalProvider(
                    LocalPayCraftSurfaceMode provides PayCraftSurfaceMode.Sheet,
                ) { content()() }
            }
        }

        val height = onNodeWithTag(rootTag).getUnclippedBoundsInRoot().height
        assertEquals(
            contentHeight,
            height,
            "Sheet mode must wrap content height. Filling the host is the bug that expanded the " +
                "sheet to full window and painted over the scrim.",
        )
        assertTrue(
            height < onNodeWithTag(hostTag).getUnclippedBoundsInRoot().height,
            "Sheet-hosted paywall must never occupy the whole window.",
        )
    }

    @Test
    fun sheetMode_widthStillFills() = runComposeUiTest {
        setContent {
            Box(Modifier.size(400.dp, hostHeight).testTag(hostTag)) {
                CompositionLocalProvider(
                    LocalPayCraftSurfaceMode provides PayCraftSurfaceMode.Sheet,
                ) { content()() }
            }
        }

        assertEquals(
            onNodeWithTag(hostTag).getUnclippedBoundsInRoot().width,
            onNodeWithTag(rootTag).getUnclippedBoundsInRoot().width,
            "Sheet mode still fills width — only height is surrendered to the container.",
        )
    }

    @Test
    fun defaultMode_isFullScreen_soStandaloneTemplatesKeepPainting() = runComposeUiTest {
        setContent {
            Box(Modifier.size(400.dp, hostHeight).testTag(hostTag)) { content()() }
        }

        assertEquals(
            onNodeWithTag(hostTag).getUnclippedBoundsInRoot().height,
            onNodeWithTag(rootTag).getUnclippedBoundsInRoot().height,
            "Without an explicit mode a template must behave exactly as it did before this change.",
        )
    }

    // ── Footer actions (dead-clickable fix) ───────────────────────────────────

    @Test
    fun footerActions_defaultToNoOpsButAreInvokable() = runComposeUiTest {
        var restored = false
        setContent {
            CompositionLocalProvider(
                LocalPayCraftPaywallFooterActions provides PayCraftPaywallFooterActions(
                    onRestore = { restored = true },
                ),
            ) {
                val actions = LocalPayCraftPaywallFooterActions.current
                TextButton(onClick = actions.onRestore) {
                    Text("RESTORE")
                }
            }
        }

        onNodeWithText("RESTORE").assertIsDisplayed()
        onNodeWithText("RESTORE").performClick()
        assertTrue(restored, "Footer RESTORE must reach the provided action, not an empty lambda.")
    }
}
