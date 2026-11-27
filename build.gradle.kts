plugins {
    alias(libs.plugins.android.kmp.library) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlinMultiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.jetbrainsCompose) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.vanniktech.mavenPublish) apply false
    alias(libs.plugins.roborazzi) apply false
    alias(libs.plugins.detekt)
    alias(libs.plugins.spotless)
    alias(libs.plugins.kotlinx.bcv)
}

// Public-API gate (paycraft-core-split): `apiDump` writes `<module>/api/`, `apiCheck` fails on drift.
// Members marked @PayCraftInternalApi cross the core/UI module boundary but are not public API.
apiValidation {
    ignoredProjects += listOf("sample-app", "cmp-paycraft-web", "cmp-paycraft-navigation")
    nonPublicMarkers += "com.mobilebytelabs.paycraft.PayCraftInternalApi"

    @OptIn(kotlinx.validation.ExperimentalBCVApi::class)
    klib {
        enabled = true
    }
}

// Detekt configuration for the entire project
detekt {
    buildUponDefaultConfig = true
    allRules = false
    config.setFrom("$rootDir/config/detekt/detekt.yml")
    baseline = file("$rootDir/config/detekt/baseline.xml")
    parallel = true
    // The plugin lives on the root project, whose own src/ is empty — without a source set the task reported
    // NO-SOURCE and analyzed nothing. Point it at every library module's Kotlin, every source set.
    source.setFrom(fileTree(rootDir) { include("cmp-*/src/*/kotlin/**/*.kt") })
}

dependencies {
    detektPlugins(libs.detekt.ktlint.wrapper)
}

tasks.withType<dev.detekt.gradle.Detekt>().configureEach {
    reports {
        html.required.set(true)
        // detekt 2.0 calls the XML report "checkstyle" and has no txt report.
        checkstyle.required.set(true)
        sarif.required.set(false)
    }
    jvmTarget = "11"
}

// Spotless configuration for code formatting
spotless {
    kotlin {
        target("**/*.kt")
        // `sample/` is a loose reference snippet (not a compiled module) — wildcard imports keep it
        // readable as documentation; it is not production source, so it is excluded from lint.
        // infra/tests/** are canary FIXTURES: their files mirror real source paths on purpose (filename rule).
        targetExclude("**/build/**/*.kt", "**/.gradle/**/*.kt", "sample/**/*.kt", "infra/tests/**/*.kt")
        ktlint(libs.versions.ktlint.get())
            .editorConfigOverride(
                mapOf(
                    "android" to "true",
                    "indent_size" to "4",
                    "continuation_indent_size" to "4",
                    "max_line_length" to "120",
                    "ktlint_function_naming_ignore_when_annotated_with" to "Composable",
                    "ktlint_standard_function-naming" to "disabled",
                    "ktlint_standard_package-name" to "disabled",
                ),
            )
        trimTrailingWhitespace()
        leadingTabsToSpaces(4)
        endWithNewline()
    }

    kotlinGradle {
        target("**/*.gradle.kts")
        targetExclude("**/build/**/*.gradle.kts")
        ktlint(libs.versions.ktlint.get())
        trimTrailingWhitespace()
        leadingTabsToSpaces(4)
        endWithNewline()
    }

    format("misc") {
        target("**/*.md", "**/.gitignore", "**/*.yaml", "**/*.yml")
        // Never lint generated / vendored trees — node_modules + JS dist contain
        // markdown/yaml we don't own (and dangling symlinks that break the scan).
        // test-results / playwright-report: git-ignored Playwright output (error-context.md is generated per failure).
        targetExclude(
            "**/build/**",
            "**/.gradle/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/test-results/**",
            "**/playwright-report/**",
        )
        trimTrailingWhitespace()
        leadingTabsToSpaces(4)
        endWithNewline()
    }
}

// Configure the existing check task to include Detekt and Spotless
tasks.named("check") {
    dependsOn("detekt", "spotlessCheck")
}

// Task to apply all fixes
tasks.register("fix") {
    group = "verification"
    description = "Applies all automatic fixes including Spotless formatting"
    dependsOn("spotlessApply")
}

// Test JVMs never touch the developer's persistent java.util.prefs node: platformSettings() returns one
// in-memory store per test JVM when this property is set (cmp-paycraft-core PlatformSettings.jvm.kt). Since the
// core split (3.0) cmp-paycraft-core and cmp-paycraft test in separate JVMs; sharing the real prefs node let one
// clear the other's cached config mid-test (ResilienceChainTest saw BuiltIn instead of Stale).
subprojects {
    tasks.withType<Test>().configureEach { systemProperty("paycraft.settings", "memory") }
}

// kotlin-js-store/*.lock must match what CI and consumers resolve: the PUBLISHED cmp-supabase-auth. With the local
// kmp-supabase-auth source build swapped in (settings.gradle.kts), its npm graph differs (it pulls `ws`), so a
// mismatch only warns here instead of failing every local JS build. CI has no local checkout and stays strict.
if (gradle.includedBuilds.any { it.name == "kmp-supabase-auth" }) {
    plugins.withType<org.jetbrains.kotlin.gradle.targets.js.yarn.YarnPlugin> {
        the<org.jetbrains.kotlin.gradle.targets.js.yarn.YarnRootExtension>().yarnLockMismatchReport =
            org.jetbrains.kotlin.gradle.targets.js.yarn.YarnLockMismatchReport.WARNING
    }
    plugins.withType<org.jetbrains.kotlin.gradle.targets.wasm.yarn.WasmYarnPlugin> {
        the<org.jetbrains.kotlin.gradle.targets.wasm.yarn.WasmYarnRootExtension>().yarnLockMismatchReport =
            org.jetbrains.kotlin.gradle.targets.js.yarn.YarnLockMismatchReport.WARNING
    }
}
