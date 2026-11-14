// cmp-paycraft-web-ui — PayCraft's web UI, loaded only by buyers (paycraft-paywall-analytics GOAL D5).
//
// The checkout page (`mountCheckout`) and the exit survey + win-back dialog (`showExitSurvey`), for websites that
// already use cmp-paycraft-web. Kept out of that module so a site that only checks `isAdFree()` on every page never
// downloads them: a page imports this one lazily, e.g. `const ui = await import("/vendor/paycraft-web-ui/paycraft-web-ui.mjs")`.
//
// It depends on NOTHING but the Kotlin stdlib — not on :cmp-paycraft-web. Kotlin/JS dead-code-eliminates per binary,
// so a dependency would re-ship its own trimmed copy of core, serialization and coroutines in this dist. Instead the
// page passes its PayCraftWeb instance in and this module calls its exported JavaScript API (`PayCraftWebApi`).
// Output: build/dist/js/productionLibrary/ (ES module + .d.mts) via
//   ./gradlew :cmp-paycraft-web-ui:jsBrowserProductionLibraryDistribution
plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("paycraft.version").get()

kotlin {
    js {
        outputModuleName.set("paycraft-web-ui")
        browser()
        nodejs()
        binaries.library()
        generateTypeScriptDefinitions()
        useEsModules()
    }

    sourceSets {
        all { languageSettings.optIn("kotlin.js.ExperimentalJsExport") }
        jsTest.dependencies {
            implementation(paycraftLibs.kotlin.test)
        }
    }
}

// The exported functions take the page's PayCraftWeb and a plain options object; Kotlin types both `any`. The
// declarations a TypeScript site needs are written here (every option optional), and package.json lists no npm
// dependencies (no shipped .mjs imports a bare specifier).
val uiLibraryDir = layout.buildDirectory.dir("dist/js/productionLibrary")
val uiOptionsDts =
    """
    |/** Options for `mountCheckout` — a plain object, every field optional. */
    |export declare interface CheckoutPageOptions {
    |    /** What the plan includes, listed in the order summary. */
    |    readonly features?: Nullable<Array<string>>;
    |    /** "Back" link target (the pricing page). Hidden when absent. */
    |    readonly backUrl?: Nullable<string>;
    |    /** Where a signed-out buyer signs in. */
    |    readonly signInUrl?: Nullable<string>;
    |    readonly termsUrl?: Nullable<string>;
    |    readonly refundUrl?: Nullable<string>;
    |    /** Ask the tenant's exit survey when the buyer leaves without paying (default true). */
    |    readonly exitSurvey?: Nullable<boolean>;
    |    /** Where "Continue" goes after a successful payment (the studio, the app's home…); defaults to backUrl. */
    |    readonly successUrl?: Nullable<string>;
    |}
    |
    """.trimMargin()
tasks.matching { it.name.endsWith("ProductionLibraryDistribution") }.configureEach {
    val dir = uiLibraryDir
    val optionsDts = uiOptionsDts
    doLast {
        val root = dir.get().asFile
        val dts = File(root, "paycraft-web-ui.d.mts")
        if (dts.exists()) {
            var text = dts.readText()
            text =
                text.replace("mountCheckout(pc: any, container: any,", "mountCheckout(pc: any, container: HTMLElement,")
            text = text.replace("options: any)", "options: Nullable<CheckoutPageOptions>)")
            if ("declare interface CheckoutPageOptions" !in text) text += "\n" + optionsDts
            dts.writeText(text)
        }
        val pkg = File(root, "package.json")
        if (pkg.exists()) {
            pkg.writeText(pkg.readText().replace(Regex("\"dependencies\": \\{[^}]*\\}"), "\"dependencies\": {}"))
        }
    }
}

// GOAL D5: this entry has its own budget (20 KB min+gzip — the checkout page and the survey for buyers only);
// infra/web-bundle-size.sh checks it, as it checks cmp-paycraft-web's 150 KB.
val webUiBundleSize by tasks.registering(Exec::class) {
    group = "verification"
    description = "Fails when the minified+gzip paycraft-web-ui library exceeds 20 KB (paycraft-paywall-analytics D5)."
    dependsOn("jsBrowserProductionLibraryDistribution")
    workingDir = rootDir
    commandLine(
        "bash",
        "infra/web-bundle-size.sh",
        "--entry",
        layout.buildDirectory
            .dir("dist/js/productionLibrary")
            .get()
            .asFile.path + ":20480",
    )
}

tasks.named("check") { dependsOn(webUiBundleSize) }

// This module calls PayCraftWeb through PayCraftWebApi.kt, not a compile dependency — so a member renamed in the
// SDK is caught here, against the SDK's built .d.mts, instead of in a buyer's browser (infra/web-ui-api-check.sh).
val webUiApiCheck by tasks.registering(Exec::class) {
    group = "verification"
    description = "Fails when PayCraftWebApi declares a member paycraft-web.d.mts no longer exports."
    dependsOn(":cmp-paycraft-web:jsBrowserProductionLibraryDistribution")
    workingDir = rootDir
    commandLine("bash", "infra/web-ui-api-check.sh")
}

tasks.named("check") { dependsOn(webUiApiCheck) }

// The CheckoutPageOptions written above is a copy of the Kotlin `external interface` — an option added there and not
// here works at runtime but breaks every TypeScript site's typecheck (2026-11-14: successUrl). Keep them identical.
val webUiOptionsDtsCheck by tasks.registering(Exec::class) {
    group = "verification"
    description =
        "Fails when the hand-written CheckoutPageOptions in paycraft-web-ui.d.mts drifts from CheckoutPage.kt."
    dependsOn("jsBrowserProductionLibraryDistribution")
    workingDir = rootDir
    commandLine("bash", "infra/web-ui-options-dts-check.sh")
}

tasks.named("check") { dependsOn(webUiOptionsDtsCheck) }
