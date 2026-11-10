// cmp-paycraft-web — PayCraft for plain JavaScript / TypeScript websites.
//
// Browser facade over :cmp-paycraft-core (no UI toolkit, no DI container started; DCE keeps only what PayCraftWeb
// reaches). The wire contract — URLs, headers, bodies, parsers, web checkout routing — is core's
// PayCraftContract, shared with the app SDK; this module only moves those bytes with the browser's own
// fetch and keeps the session in localStorage. It exports one class (PayCraftWeb) plus plain data
// classes. Output: build/dist/js/productionLibrary/ (ES module + .d.mts) via
//   ./gradlew :cmp-paycraft-web:jsBrowserProductionLibraryDistribution
plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
    alias(paycraftLibs.plugins.kotlin.serialization)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("paycraft.version").get()

kotlin {
    js {
        outputModuleName.set("paycraft-web")
        browser()
        nodejs()
        binaries.library()
        generateTypeScriptDefinitions()
        useEsModules()
    }

    sourceSets {
        all {
            languageSettings.optIn("kotlin.js.ExperimentalJsExport")
            languageSettings.optIn("com.mobilebytelabs.paycraft.PayCraftInternalApi")
        }
        jsMain.dependencies {
            implementation(project(":cmp-paycraft-core"))
            implementation(paycraftLibs.kotlinx.serialization.json)
            implementation(paycraftLibs.kotlinx.coroutines.core)
        }
        jsTest.dependencies {
            implementation(paycraftLibs.kotlin.test)
            implementation(paycraftLibs.kotlinx.coroutines.test)
        }
    }
}

// The library distribution, corrected for what a website consumes (paycraft-core-split 02 audit F1/F4):
//  - core depends on Ktor / supabase-kt, whose eager initialisers make the JS compiler add side-effect imports
//    AND a duplicated `export declare const initHook` to paycraft-web.d.mts that the .mjs does not export
//    (a strict tsc fails "Cannot redeclare block-scoped variable 'initHook'"). Those declarations are dropped.
//  - package.json lists @js-joda/core and ws (npm deps of klibs the SDK never imports); a site installing the
//    vendored package would pull them in for nothing. `dependencies` is emptied — no shipped .mjs imports a
//    bare npm specifier (infra/web-api-diff.sh checks that).
//  - `mountCheckout` takes a PLAIN options object. Kotlin types it with an external interface it does not
//    declare (an exported interface would carry a brand symbol no object literal has), so the declaration is
//    written here — every field optional — and the container is typed as the DOM element it is.
val webLibraryDir = layout.buildDirectory.dir("dist/js/productionLibrary")
val checkoutOptionsDts =
    """
    |/** Options for `PayCraftWeb.mountCheckout` — a plain object, every field optional. */
    |export declare interface CheckoutPageOptions {
    |    /** What the plan includes, listed in the order summary. */
    |    readonly features?: Nullable<Array<string>>;
    |    /** "Back" link target (the pricing page). Hidden when absent. */
    |    readonly backUrl?: Nullable<string>;
    |    /** Where a signed-out buyer signs in. */
    |    readonly signInUrl?: Nullable<string>;
    |    readonly termsUrl?: Nullable<string>;
    |    readonly refundUrl?: Nullable<string>;
    |}
    |
    """.trimMargin()
// Both the browser and the Node distribution tasks write this directory, so both get the correction.
tasks.matching { it.name.endsWith("ProductionLibraryDistribution") }.configureEach {
    val dir = webLibraryDir
    val optionsDts = checkoutOptionsDts
    doLast {
        val root = dir.get().asFile
        val dts = File(root, "paycraft-web.d.mts")
        if (dts.exists()) {
            val initHook =
                Regex("(?m)^/\\*\\* @deprecated\\s*\\*/\\n(export declare const initHook: \\{\\n(?:.*\\n)*?\\};\\n)")
            var text = dts.readText().replace(initHook, "")
            text = text.replace("mountCheckout(container: any,", "mountCheckout(container: HTMLElement,")
            if ("declare interface CheckoutPageOptions" !in text) text += "\n" + optionsDts
            dts.writeText(text)
        }
        val pkg = File(root, "package.json")
        if (pkg.exists()) {
            pkg.writeText(pkg.readText().replace(Regex("\"dependencies\": \\{[^}]*\\}"), "\"dependencies\": {}"))
        }
    }
}

// GOAL D4: the size budget fails the build, it is not advisory. Measures what a website downloads —
// every .mjs of the production library minified + gzipped — against 150 KB (infra/web-bundle-size.sh).
val webBundleSize by tasks.registering(Exec::class) {
    group = "verification"
    description = "Fails when the minified+gzip paycraft-web library exceeds 150 KB (GOAL D4)."
    dependsOn("jsBrowserProductionLibraryDistribution")
    workingDir = rootDir
    commandLine(
        "bash",
        "infra/web-bundle-size.sh",
        "--dist",
        layout.buildDirectory
            .dir("dist/js/productionLibrary")
            .get()
            .asFile.path,
    )
}

tasks.named("check") { dependsOn(webBundleSize) }
