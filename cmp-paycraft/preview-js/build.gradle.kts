// cmp-paycraft/preview-js — Kotlin/JS preview bundle for the dashboard paywall designer (AC-33b).
//
// v1 SCOPE (this file): a *thin* Kotlin/JS subproject that produces a browser bundle the
// dashboard iframes. It depends on cmp-paycraft commonMain for the shared types (BillingState,
// SubscriptionStatus, PaywallTemplate enum, SuiteConfig) so the JS bundle and the native KMP
// app share the *exact same data model*. Rendering inside Preview.kt uses straight kotlinx.browser
// DOM manipulation that mirrors the Compose template visual contract (colors, layout, spacing).
//
// v2 SCOPE (NOT IN THIS COMMIT): full Compose-for-Web port — replace DOM manipulation in Preview.kt
// with `renderComposable { tmpl.render(state, products, …) }` once the `cmp-paycraft` UI composables
// are audited for jsMain compatibility (some androidMain `KeyEventDispatcher` references currently
// keep the full Compose tree off the browser target). Once that's done, pixel parity becomes exact.
// See top-of-file note in Preview.kt for the migration boundary.

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinxSerialization)
}

kotlin {
    js(IR) {
        browser {
            binaries.executable()
            commonWebpackConfig {
                outputFileName = "paycraft-preview.js"
            }
        }
    }

    sourceSets {
        val jsMain by getting {
            dependencies {
                // Shared data model — same BillingState, SuiteConfig, etc. that the SDK uses.
                implementation(project(":cmp-paycraft"))
                implementation(libs.kotlinx.serialization.json)
            }
        }
    }
}
