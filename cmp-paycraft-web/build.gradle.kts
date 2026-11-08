// cmp-paycraft-web — PayCraft for plain JavaScript / TypeScript websites.
//
// Deliberately independent of :cmp-paycraft: that module's commonMain carries Compose, Koin, Store5
// and supabase-kt, which a website would download as several MB of JavaScript. This module is
// Kotlin/JS only, uses the browser's own fetch, and exports one class (PayCraftWeb) plus plain data
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
        }
        jsMain.dependencies {
            implementation(paycraftLibs.kotlinx.serialization.json)
            implementation(paycraftLibs.kotlinx.coroutines.core)
        }
        jsTest.dependencies {
            implementation(paycraftLibs.kotlin.test)
            implementation(paycraftLibs.kotlinx.coroutines.test)
        }
    }
}
