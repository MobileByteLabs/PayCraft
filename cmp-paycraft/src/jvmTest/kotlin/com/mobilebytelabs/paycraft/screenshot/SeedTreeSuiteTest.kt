package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import com.mobilebytelabs.paycraft.presentation.tree.PaywallNode
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeContent
import com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser
import com.mobilebytelabs.paycraft.presentation.tree.RenderContext
import com.mobilebytelabs.paycraft.presentation.tree.effectiveProperties
import com.mobilebytelabs.paycraft.presentation.tree.monthlyEquivalentNote
import com.mobilebytelabs.paycraft.presentation.tree.savingsVersusMonthly
import com.mobilebytelabs.paycraft.presentation.tree.treeColorOrNull
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * D3/D4 — the remaining three templates as seed trees, each captured for parity review.
 *
 * These three were the hardcoded-English templates (F13): `MinimalFree`, `DarkFree` and
 * `PremiumFree` all contain the literal "Upgrade to Premium" in Kotlin, so no tenant could ever
 * translate or reword them. As trees the copy is `text_lid` into `localizations`, which fixes that
 * defect as a side effect of the conversion rather than as separate work.
 *
 * Dark is the interesting one: its template imposes a dark scheme regardless of the host's, so its
 * tree has to carry explicit colours. That makes it the real test of the RRGGBBAA colour pipeline.
 */
@OptIn(ExperimentalTestApi::class)
class SeedTreeSuiteTest {

    /**
     * Read the SHIPPED seed files rather than a copy of their JSON. An inline copy drifts: an
     * earlier pass added `color_scheme` to the wrong copy and the dark capture stayed unreadable
     * while every test passed. Reading the real file makes these tests evidence that the artifact
     * tenants receive parses and renders — which is the only claim worth making.
     */
    private fun seed(name: String): String {
        val f = java.io.File("$SEED_DIR/$name.json")
        assertTrue(f.exists(), "shipped seed missing: ${f.absolutePath}")
        return f.readText()
    }

    private fun products() = listOf(
        Product.Subscription("p_year", "sku_year", "Annual", 0, Product.Subscription.Interval.YEAR, Money(4199, "USD")),
        Product.Subscription(
            "p_month",
            "sku_month",
            "Monthly",
            1,
            Product.Subscription.Interval.MONTH,
            Money(699, "USD"),
        ),
    )

    private fun price(role: String): PackagePrice {
        val p = if (role == "${'$'}rc_annual") products()[0] else products()[1]
        return PackagePrice(
            display = (p as Product.Subscription).basePrice.format(),
            perPeriodNote = p.monthlyEquivalentNote(),
            savingsPercent = p.savingsVersusMonthly(products()),
        )
    }

    @Composable
    private fun Frame(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(Modifier.size(411.dp, 891.dp).background(MaterialTheme.colorScheme.surface)) {
                PayCraftThemeProvider(content = content)
            }
        }
    }

    /**
     * Roborazzi writes wherever it is told and reports success either way — an earlier pass sent
     * these to a directory literally named `$DIR` (a mis-escaped template string) and all three
     * tests still passed while producing no golden at all. Assert the file exists.
     */
    private fun assertCaptured(path: String) {
        val f = java.io.File(path)
        assertTrue(f.exists() && f.length() > 0L, "captureRoboImage wrote nothing to $path")
    }

    @Test
    fun minimal_seed_tree() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(seed("minimal")))
        setContent {
            Frame { PaywallTreeContent(wf, RenderContext(selectedPackageRole = "${'$'}rc_annual"), priceFor = ::price) }
        }
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Annual").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()
        onRoot().captureRoboImage(P_MINIMAL)
        assertCaptured(P_MINIMAL)
    }

    @Test
    fun dark_seed_tree_carries_its_own_colours() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(seed("dark")))
        // Host scheme is deliberately LIGHT: the tree's own colours must win, the same property
        // `dark_template_device_conflict_render` exists to protect for the Kotlin template.
        setContent {
            Frame { PaywallTreeContent(wf, RenderContext(selectedPackageRole = "${'$'}rc_annual"), priceFor = ::price) }
        }
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()
        onRoot().captureRoboImage(P_DARK)
        assertCaptured(P_DARK)
    }

    @Test
    fun premium_seed_tree() = runComposeUiTest {
        val wf = assertNotNull(PaywallTreeParser.parse(seed("premium")))
        setContent {
            Frame { PaywallTreeContent(wf, RenderContext(selectedPackageRole = "${'$'}rc_annual"), priceFor = ::price) }
        }
        onNodeWithText("Upgrade to Premium").assertIsDisplayed()
        onNodeWithText("Unlock everything PayCraft has to offer.").assertIsDisplayed()
        onNodeWithText("Continue").assertIsDisplayed()
        onRoot().captureRoboImage(P_PREMIUM)
        assertCaptured(P_PREMIUM)
    }

    /**
     * Every shipped seed must SHOW which plan the CTA will buy.
     *
     * This is not a styling nicety — it is the one piece of feedback between "tapped a plan" and
     * "charged for a plan". It is also the easiest thing in this pipeline to ship broken: an
     * override whose `conditions` are unrecognised is DROPPED by the parser (deliberately — see
     * PaywallTreeParser.overrides), so a seed written with `"conditions": ["selected"]` instead of
     * `[{"type":"selected"}]` parses clean, renders, and silently has no selected state at all.
     * The first draft of these seeds had exactly that bug. So assert the effect, not the JSON.
     */
    @Test
    fun every_seed_marks_the_selected_package() {
        for (name in listOf("branded_stack", "minimal", "dark", "premium")) {
            val wf = assertNotNull(PaywallTreeParser.parse(seed(name)), "$name failed to parse")
            val packages = mutableListOf<PaywallNode.Package>()
            fun walk(n: PaywallNode?) {
                when (n) {
                    is PaywallNode.Package -> {
                        packages += n
                        walk(n.stack)
                    }
                    is PaywallNode.Stack -> n.components.forEach(::walk)
                    is PaywallNode.Footer -> n.components.forEach(::walk)
                    is PaywallNode.PurchaseButton -> walk(n.stack)
                    else -> Unit
                }
            }
            wf.steps.forEach { walk(it.root) }
            assertTrue(packages.size >= 2, "$name: expected >=2 packages, got ${packages.size}")

            val role = packages.first().roleIdentifier
            val selectedCtx = RenderContext(selectedPackageRole = role)
            val on = packages.first().stack.effectiveProperties(selectedCtx, role)
            val off = packages.last().stack.effectiveProperties(selectedCtx, packages.last().roleIdentifier)

            assertTrue(on.containsKey("border"), "$name: selected package has no border override")
            // A colour is either a TOKEN (resolved against the tenant's theme — D11) or a literal
            // hex. Anything else resolves to nothing and draws no ring at all, which is the failure
            // this asserts against: a selected plan the user cannot see is selected.
            val border = on["border"]
            assertTrue(
                border in PAYWALL_COLOR_TOKENS || treeColorOrNull(border) != null,
                "$name: border '$border' is neither a known token nor a parseable hex",
            )
            assertTrue((on["border_width"]?.toIntOrNull() ?: 0) > 0, "$name: zero-width border draws nothing")
            assertTrue(off.isEmpty(), "$name: an UNSELECTED package was styled as selected")
        }
    }

    /**
     * Every node type in every shipped seed must be one `validate_paywall_workflow()` accepts.
     *
     * The two vocabularies are maintained in different languages in different repos' worth of
     * distance — Kotlin `PaywallNode` and a SQL `v_known_types` array — and they fail in opposite
     * directions: a type the SDK renders but the server rejects is a tree the dashboard can never
     * save, and a type the server accepts but the SDK does not know renders as `Unknown`. This
     * reads the migration itself rather than restating its list, so the check cannot drift from it.
     */
    @Test
    fun shipped_seeds_use_only_types_the_server_accepts() {
        val sql = java.io.File(MIGRATION).readText()
        val block = Regex("""v_known_types\s+TEXT\[]\s*:=\s*ARRAY\s*\[(.*?)]""", RegexOption.DOT_MATCHES_ALL)
            .find(sql)?.groupValues?.get(1)
        assertNotNull(block, "could not find v_known_types in $MIGRATION — did the migration move?")
        val known = Regex("'([a-z_]+)'").findAll(block).map { it.groupValues[1] }.toSet()
        assertTrue(known.size > 5, "parsed only ${known.size} known types — the regex is wrong, not the seeds")

        for (name in listOf("branded_stack", "minimal", "dark", "premium")) {
            // Walk COMPONENT positions only. A regex over every `"type"` in the file also matches
            // `{"type":"hex"}` inside a colour and `{"type":"selected"}` inside an override
            // condition — neither of which the server's jsonpath (`…components[*].type`) looks at.
            // A check that flags them reports a defect that does not exist, which is worse than no
            // check: it trains the reader to ignore it.
            val used = mutableSetOf<String>()
            fun walk(el: kotlinx.serialization.json.JsonElement) {
                val obj = el as? kotlinx.serialization.json.JsonObject ?: return
                (obj["type"] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull?.let(used::add)
                for (key in listOf("components", "items")) {
                    (obj[key] as? kotlinx.serialization.json.JsonArray)?.forEach(::walk)
                }
                for (key in listOf("stack", "components_config")) {
                    (obj[key] as? kotlinx.serialization.json.JsonObject)?.let(::walk)
                }
            }
            val root = kotlinx.serialization.json.Json.parseToJsonElement(seed(name))
                as kotlinx.serialization.json.JsonObject
            (root["steps"] as? kotlinx.serialization.json.JsonArray)?.forEach { step ->
                (
                    (step as? kotlinx.serialization.json.JsonObject)
                        ?.get("components_config") as? kotlinx.serialization.json.JsonObject
                    )?.let(::walk)
            }

            assertTrue(used.isNotEmpty(), "$name: walked no components at all")
            val unknown = used - known
            assertTrue(unknown.isEmpty(), "$name uses types the server would reject: $unknown")
        }
    }

    /**
     * The gallery migration must carry EXACTLY the trees the seed files hold.
     *
     * Migration 102 seeds `paywall_templates` with the same four workflows, inlined as SQL literals
     * because a migration cannot read a file. That is a second copy, and a second copy is the defect
     * class that already cost this epic one silent failure (see the class KDoc). The copy is
     * generated, never hand-edited — this test is what makes that claim enforceable: it re-parses
     * the JSON back out of the SQL and compares it to the file, so a hand-edit on either side fails
     * here instead of shipping a gallery that offers a template nobody can reproduce.
     */
    @Test
    fun seed_files_match_the_gallery_migration() {
        val sql = java.io.File(GALLERY_MIGRATION)
        assertTrue(sql.exists(), "missing $GALLERY_MIGRATION")
        val text = sql.readText()

        for ((slug, file) in listOf(
            "branded-stack" to "branded_stack",
            "premium" to "premium",
            "minimal" to "minimal",
            "dark" to "dark",
        )) {
            // Match the jsonb literal specifically, not "the next quoted thing after the slug" —
            // that is the row's NAME. The generator puts the tree on its own line ending in
            // `'::jsonb`, and SQL doubles any embedded quote (one description contains "app's").
            val row = Regex(
                """\('""" + Regex.escape(slug) + """',[\s\S]*?\n\s*'(.*)'::jsonb\)""",
            ).find(text)
            assertNotNull(row, "migration has no row for $slug")
            val fromSql = Json.parseToJsonElement(row.groupValues[1].replace("''", "'"))
            val fromFile = Json.parseToJsonElement(seed(file))
            assertEquals(
                fromFile,
                fromSql,
                "$slug: the gallery migration and the seed file have diverged — regenerate 102 " +
                    "rather than editing either by hand",
            )
        }
    }

    private companion object {
        /** Mirrors `treeTokenColorOrNull`; a token added there without a seed using it is fine, the
         *  reverse is a ring that never draws. */
        val PAYWALL_COLOR_TOKENS = setOf(
            "accent",
            "accent_soft",
            "on_accent",
            "surface",
            "on_surface",
            "on_surface_variant",
        )

        const val DIR = "src/jvmTest/resources/screenshots"
        const val SEED_DIR = "src/commonMain/composeResources/files/paycraft/seed"
        const val MIGRATION = "../supabase/migrations/100_paywall_component_tree.sql"
        const val GALLERY_MIGRATION = "../supabase/migrations/102_paywall_template_gallery.sql"
        const val P_MINIMAL = "$DIR/seed_minimal.png"
        const val P_DARK = "$DIR/seed_dark.png"
        const val P_PREMIUM = "$DIR/seed_premium.png"
    }
}
