/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The subscription-settings section, RENDERED.
 *
 * WHY THIS EXISTS
 * `PayCraftPlanSection` and its five styles were authored, reviewed and shipped with
 * compile + logic verification only — 562 unit tests, zero pixels. Every report on them carried the
 * same caveat: "none of this has been seen rendered". Five style presets and a theme whose defaults
 * resolve from MaterialTheme is precisely the surface where that gap hides a real defect: a style
 * that lays out on top of itself, a token that resolves transparent-on-transparent, a badge that
 * renders at zero size. None of those fail a unit test.
 *
 * ASSERT BEFORE CAPTURE — the discipline from PaywallStateMatrixTest, which states it best:
 * "A golden alone proves a bitmap was written; it cannot say the bitmap contains the thing that
 * defines the state. A blank render produces a perfectly stable golden that passes forever."
 * So every case asserts the tag that only exists if the style rendered its defining row, and the
 * assertion runs BEFORE captureRoboImage — a broken surface fails rather than pinning a broken
 * frame as the reference.
 *
 * WHY THE STYLE BODIES AND NOT THE PUBLIC COMPOSABLE
 * `PayCraftPlanSection` resolves its repository from Koin and gates on
 * `PayCraft.isConfigured`, so rendering it here would test the harness as much as the UI. The five
 * internal style functions take state/copy/theme explicitly — they ARE the production composables,
 * with the resolution step removed. State is constructed directly for the same reason: it makes the
 * TIER the variable under test rather than a mock's behaviour.
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.ui.CardSettings
import com.mobilebytelabs.paycraft.ui.CompactSettings
import com.mobilebytelabs.paycraft.ui.HeroSettings
import com.mobilebytelabs.paycraft.ui.MinimalSettings
import com.mobilebytelabs.paycraft.ui.PayCraftPlanSectionTheme
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.PlanSectionCopy
import com.mobilebytelabs.paycraft.ui.PlanSectionState
import com.mobilebytelabs.paycraft.ui.RowsSettings
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class PayCraftPlanSectionScreenshotTest {

    // The bundled English copy, as rememberSettingsCopy() resolves it when a tenant has configured
    // nothing — the commonest production case by a wide margin.
    private val copy = PlanSectionCopy(
        freeLabel = "Free",
        trialLabel = "Trial",
        premiumLabel = "Premium",
        freeSupporting = "Free plan — no active subscription",
        trialSupporting = "Free trial active",
        trialEndingToday = "Trial ends today",
        trialOneDayLeft = "Trial — 1 day left",
        trialDaysLeftTemplate = "Trial — {days} days left",
        premiumSupporting = "Subscription active",
        renewsOnTemplate = "Renews {date}",
        expiresOnTemplate = "Expires {date}",
        manageLabel = "Manage Subscription",
        upgradeLabel = "Get Premium",
        restoreLabel = "Restore Purchases",
        fromPriceTemplate = "From {price}",
        perIntervalTemplate = "per {interval}",
        billedThroughTemplate = "Billed through {store}",
    )

    // `planLine` / `billedThrough` default to the values the real derivation produces for each tier
    // (planLineFor / billedThroughFor, covered in PayCraftPlanSectionLogicTest) so the goldens
    // render the SHIPPING card rather than a stripped one. A golden of a card with its price line
    // omitted would keep passing while the real card lost it — the goldens' whole job is to notice.
    private fun state(
        tier: EntitlementTier,
        supporting: String,
        canManage: Boolean = tier != EntitlementTier.FREE,
        planLine: String? = if (tier == EntitlementTier.FREE) "From ₹89 per week" else "₹1259 per year",
        billedThrough: String? = if (tier == EntitlementTier.FREE) null else "Billed through Google Play",
    ) =
        PlanSectionState(
            planLine = planLine,
            billedThrough = billedThrough,
            visible = true,
            tier = tier,
            statusLabel = when (tier) {
                EntitlementTier.FREE -> copy.freeLabel
                EntitlementTier.TRIAL -> copy.trialLabel
                EntitlementTier.PREMIUM -> copy.premiumLabel
            },
            supportingText = supporting,
            canManage = canManage,
            onManage = {},
            onRestoreClick = {},
        )

    private val premium = state(EntitlementTier.PREMIUM, copy.renewsOn("14 Nov 2026"))
    private val free = state(EntitlementTier.FREE, copy.freeSupporting)
    private val trial = state(EntitlementTier.TRIAL, copy.trialDaysLeft(6))

    // ── The five presets, premium tier ───────────────────────────────────────────────────────────
    //
    // Premium is the tier worth capturing per-style: it renders the most — status, supporting line
    // with a date, the Manage row, the tier badge — so a layout defect has the most room to show.

    @Test
    fun minimal_premium_render() = runComposeUiTest {
        setContent { DeterministicTheme { MinimalSettings(premium, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        // Both the tier NAME and the date, on one line. This assertion is why the fix exists:
        // Minimal rendered the date alone and dropped `statusLabel`, so the row read "renews what?"
        // in a settings list with no header. Caught on the first render of these styles.
        onNodeWithText("Premium · Renews 14 Nov 2026").assertIsDisplayed()
        onRoot().captureRoboImage(P_MINIMAL)
        assertCaptured(P_MINIMAL)
    }

    @Test
    fun rows_premium_render() = runComposeUiTest {
        setContent { DeterministicTheme { RowsSettings(premium, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        // Manage is the action a premium user came for; Restore must also be reachable (store
        // review rejects an app with no restore path — FAILURE_MODES F39).
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW).assertIsDisplayed()
        onRoot().captureRoboImage(P_ROWS)
        assertCaptured(P_ROWS)
    }

    @Test
    fun card_premium_render() = runComposeUiTest {
        setContent { DeterministicTheme { CardSettings(premium, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW).assertIsDisplayed()
        onRoot().captureRoboImage(P_CARD)
        assertCaptured(P_CARD)
    }

    @Test
    fun hero_premium_render() = runComposeUiTest {
        setContent { DeterministicTheme { HeroSettings(premium, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW).assertIsDisplayed()
        onRoot().captureRoboImage(P_HERO)
        assertCaptured(P_HERO)
    }

    @Test
    fun compact_premium_render() = runComposeUiTest {
        // Compact takes no `copy` — it is a single inline row by definition. Asserting the status
        // row still displays is the check that "compact" did not become "collapsed to nothing".
        setContent { DeterministicTheme { CompactSettings(premium, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        onRoot().captureRoboImage(P_COMPACT)
        assertCaptured(P_COMPACT)
    }

    // ── Tier behaviour within one style ──────────────────────────────────────────────────────────

    @Test
    fun rows_free_shows_upgrade_and_not_manage() = runComposeUiTest {
        // The PrimaryAction contract: FREE gets Upgrade, never Manage. Rendering Manage to someone
        // with nothing to manage is a row that cannot do anything when tapped.
        setContent { DeterministicTheme { RowsSettings(free, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_UPGRADE_ROW).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW).assertDoesNotExist()
        onNodeWithText("Free plan — no active subscription").assertIsDisplayed()
        onRoot().captureRoboImage(P_ROWS_FREE)
        assertCaptured(P_ROWS_FREE)
    }

    @Test
    fun rows_trial_shows_the_countdown() = runComposeUiTest {
        // The {days} substitution, rendered. A template that failed to substitute would show the
        // literal "{days}" — visible here, invisible to a test that only checks the template field.
        setContent { DeterministicTheme { RowsSettings(trial, copy, theme(), {}) } }
        onNodeWithText("Trial — 6 days left").assertIsDisplayed()
        onRoot().captureRoboImage(P_ROWS_TRIAL)
        assertCaptured(P_ROWS_TRIAL)
    }

    @Test
    fun rows_premium_without_a_manage_target_omits_the_row() = runComposeUiTest {
        // `canManage = false` is a desktop/web build with no store page and no provider portal.
        // The row must be ABSENT, not present-and-inert — the failure this flag exists to prevent.
        val noTarget = state(EntitlementTier.PREMIUM, copy.premiumSupporting, canManage = false)
        setContent { DeterministicTheme { RowsSettings(noTarget, copy, theme(), {}) } }
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_MANAGE_ROW).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_RESTORE_ROW).assertIsDisplayed()
        onRoot().captureRoboImage(P_ROWS_NO_MANAGE)
        assertCaptured(P_ROWS_NO_MANAGE)
    }

    // ── Theming ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun theme_showTierBadge_changes_the_render() {
        // ONE test, BOTH captures. The first version split this across two @Test functions and the
        // second read the file the first wrote — an order-dependent test that failed with
        // FileNotFoundException when run alone. Same flakiness class as a shared-global test: the
        // fix is self-containment, not an ordering annotation.
        //
        // CARD, not Rows. An earlier attempt used Rows and the two goldens came out BYTE-IDENTICAL
        // (md5 c94dd463…) — because `TierBadge` is drawn by Card/Hero/Compact while Rows uses
        // `StatusBlock`, which has no badge at all. The field was fine; the test proved nothing.
        //
        // That is the failure a golden cannot catch alone: a theme field read nowhere produces a
        // perfectly stable reference. Hence the DIFFER assertion — the only check that separates
        // "the override applied" from "the override was ignored".
        runComposeUiTest {
            setContent { DeterministicTheme { CardSettings(premium, copy, theme(), {}) } }
            onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
            onRoot().captureRoboImage(P_CARD_BADGE)
        }
        assertCaptured(P_CARD_BADGE)

        runComposeUiTest {
            setContent {
                DeterministicTheme {
                    CardSettings(premium, copy, theme().copy(showTierBadge = false), {})
                }
            }
            onNodeWithTag(PayCraftTestTags.SUBSCRIPTION_STATUS_ROW).assertIsDisplayed()
            onRoot().captureRoboImage(P_CARD_NO_BADGE)
        }
        assertCaptured(P_CARD_NO_BADGE)

        assertTrue(
            !java.io.File(P_CARD_BADGE).readBytes().contentEquals(java.io.File(P_CARD_NO_BADGE).readBytes()),
            "showTierBadge=false produced a BYTE-IDENTICAL render — the theme field is being " +
                "ignored by this style, or the style draws no badge to hide",
        )
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────

    @Composable
    private fun theme(): PayCraftPlanSectionTheme = PayCraftPlanSectionTheme.defaults()

    /**
     * The production layout, reproduced exactly.
     *
     * The inner COLUMN is load-bearing and was missing from the first version of this harness.
     * `RowsSettings` emits its status block, primary action, divider and restore row as SIBLINGS
     * and relies on its caller for vertical stacking — `PayCraftPlanSection` wraps the
     * whole `when (style)` in `Column(modifier.fillMaxWidth())`. Rendering a style inside a bare
     * Box instead let every row draw at the same origin, and the recorded golden showed "Premium",
     * "Manage Subscription" and "Restore Purchases" overlaid into illegible pixels.
     *
     * Every tag-assertion still PASSED on that frame — each node existed and was "displayed". A
     * golden only catches this if somebody looks at it, which is the argument for recording one.
     *
     * Card and Hero own their own container, so they were unaffected; Rows and Minimal were not.
     */
    @Composable
    private fun DeterministicTheme(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 320.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                PayCraftThemeProvider {
                    Column(modifier = Modifier.fillMaxWidth()) { content() }
                }
            }
        }
    }

    private fun assertCaptured(path: String) {
        val f = java.io.File(path)
        assertTrue(
            f.exists() && f.length() > 0L,
            "captureRoboImage did not write $path — verifyRoborazziJvm would be vacuously green",
        )
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"
        const val P_MINIMAL = "$DIR/plan_section_minimal_premium.png"
        const val P_ROWS = "$DIR/plan_section_rows_premium.png"
        const val P_CARD = "$DIR/plan_section_card_premium.png"
        const val P_HERO = "$DIR/plan_section_hero_premium.png"
        const val P_COMPACT = "$DIR/plan_section_compact_premium.png"
        const val P_ROWS_FREE = "$DIR/plan_section_rows_free.png"
        const val P_ROWS_TRIAL = "$DIR/plan_section_rows_trial.png"
        const val P_ROWS_NO_MANAGE = "$DIR/plan_section_rows_premium_no_manage.png"
        const val P_CARD_BADGE = "$DIR/plan_section_card_premium_badge.png"
        const val P_CARD_NO_BADGE = "$DIR/plan_section_card_premium_no_badge.png"
    }
}
