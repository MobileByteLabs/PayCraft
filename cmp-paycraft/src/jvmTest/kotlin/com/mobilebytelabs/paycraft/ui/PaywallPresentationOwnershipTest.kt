/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Every SDK surface that offers an upgrade affordance must OWN its paywall presentation.
 *
 * ## The defect this exists to catch
 *
 * [com.mobilebytelabs.paycraft.PayCraft.presentPaywall] only flips `PayCraft.paywallPresentation`,
 * a flow the HOST has to observe and render. Most hosts never read it — cappy, the first consumer,
 * does not — so a surface that merely CALLS it absorbs the tap into nothing.
 *
 * On 2026-10-19 `PayCraftPlanSection`'s "Get Premium" row did exactly that on a physical device:
 * logcat showed `[presentPaywall] manual — mode=AdSupported`, and no paywall appeared. Restore on
 * the same component went through `rememberRestorePresenter()`; upgrade was a bare
 * `{ PayCraft.presentPaywall() }`. Pure asymmetry, and invisible to everything we had:
 *
 *  - the row reported `clickable=true` in the view hierarchy
 *  - its handler ran
 *  - `PayCraftPlanSectionScreenshotTest`'s goldens matched (the ROW renders fine; it is the sheet
 *    that never arrives, and a golden of the section cannot see a sheet that was never emitted)
 *  - a logic test asserting `paywallPresentation is Shown` PASSES ON THE BROKEN CODE, because the
 *    broken code did call `presentPaywall()`. That is why this test is structural rather than a
 *    copy of `PayCraftTeaseGateTest.softGate_lockedTap_signalsTheUpsell_notJustAbsorbsIt` — that
 *    assertion cannot distinguish "signals" from "presents", which is the entire defect.
 *
 * ## Why structural rather than a Compose assertion
 *
 * Asserting the RENDERED sheet needs a global Koin graph: `PayCraftPaywallSheet` resolves
 * `koinViewModel()`, and Material3 hosts sheet content in a separate window layer that does not
 * inherit composition locals, so a scoped `KoinApplication {}` is invisible to it. Starting global
 * Koin in this module breaks sibling tests in the same JVM — `PayCraftTeaseGateTest` records that
 * trade and settles for the weaker assertion. A source-level invariant has neither problem, holds
 * for surfaces that do not exist yet, and fails loudly on the exact shape that shipped.
 *
 * It is a real guard, not a proxy: the thing that was wrong WAS the shape.
 */
class PaywallPresentationOwnershipTest {

    private val uiDir = File("src/commonMain/kotlin/com/mobilebytelabs/paycraft/ui")

    /**
     * Files allowed to call `presentPaywall()` without presenting anything, each for a stated
     * reason. Deliberately a short list with justifications rather than a glob — a new entry should
     * cost a sentence of thought.
     */
    private val signalOnlyByDesign = mapOf(
        "PayCraftPresenters.kt" to
            "IS the presenter seam — it emits the sheet and returns the trigger",
    )

    @Test
    fun everyUiSurfaceThatSignalsThePaywallAlsoPresentsIt() {
        assertTrue(uiDir.isDirectory, "ui source dir not found at ${uiDir.absolutePath} — wrong working dir?")

        val offenders = uiDir.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.name !in signalOnlyByDesign }
            .mapNotNull { file ->
                val src = file.readText()
                if (!src.contains("PayCraft.presentPaywall()")) return@mapNotNull null
                // Presenting means one of: delegating to the presenter seam, or emitting a paywall
                // sheet directly (PayCraftTeaseGate does the latter, and predates the seam).
                val presents = src.contains("rememberPaywallPresenter()") ||
                    src.contains("PayCraftPaywallSheet(") ||
                    src.contains("PayCraftSheet(")
                if (presents) null else file.name
            }
            .toList()

        if (offenders.isNotEmpty()) {
            fail(
                buildString {
                    appendLine("These UI surfaces SIGNAL the paywall but never present it:")
                    offenders.forEach { appendLine("  · $it") }
                    appendLine()
                    appendLine("`PayCraft.presentPaywall()` only flips a flow the host must observe, and most hosts")
                    appendLine("never do — so the tap reaches nothing. Use `rememberPaywallPresenter()`, which emits")
                    appendLine("the sheet AND calls presentPaywall() for the analytics trigger:")
                    appendLine()
                    appendLine("    val upgrade = rememberPaywallPresenter()")
                    appendLine()
                    appendLine("If a file genuinely only signals, add it to `signalOnlyByDesign` with the reason.")
                },
            )
        }
    }

    /**
     * The specific regression, pinned by name.
     *
     * The sweep above would also pass if someone deleted the upgrade affordance altogether, so this
     * asserts the section still HAS an upgrade and that it routes through the seam.
     */
    @Test
    fun planSectionUpgradeGoesThroughThePresenterSeam() {
        val src = File(uiDir, "PayCraftPlanSection.kt").readText()

        assertTrue(
            src.contains("val upgrade = rememberPaywallPresenter()"),
            "PayCraftPlanSection's upgrade must use the presenter seam — a bare " +
                "`{ PayCraft.presentPaywall() }` renders nothing in a host that does not observe " +
                "paywallPresentation, which is the 2026-10-19 dead-row defect.",
        )
        assertTrue(
            src.contains("rememberRestorePresenter()"),
            "restore must stay on its presenter too — the two affordances drifting apart is how " +
                "the upgrade half regressed in the first place.",
        )
    }
}
