import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
    alias(paycraftLibs.plugins.android.kmp.library)
    alias(paycraftLibs.plugins.kotlin.serialization)
    alias(paycraftLibs.plugins.jetbrainsCompose)
    alias(paycraftLibs.plugins.compose.compiler)
    alias(paycraftLibs.plugins.vanniktech.mavenPublish)
    // Roborazzi Gradle plugin — generates recordRoborazziJvm / verifyRoborazziJvm tasks
    // once `roborazzi-compose-desktop` is on the jvmTest classpath. Applied to :cmp-paycraft
    // only (AC-15 device-free golden gate for skeleton + Content paywall + ProductList).
    alias(paycraftLibs.plugins.roborazzi)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("paycraft.version").get()

@OptIn(ExperimentalKotlinGradlePluginApi::class, ExperimentalWasmDsl::class)
kotlin {
    applyDefaultHierarchyTemplate()

    jvm()

    android {
        namespace = "com.mobilebytelabs.paycraft"
        compileSdk =
            paycraftLibs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            paycraftLibs.versions.android.minSdk
                .get()
                .toInt()
        androidResources.enable = true
    }

    iosArm64()
    iosSimulatorArm64()

    // The StoreKit shim (swiftc → cinterop) moved to cmp-paycraft-core with the native billing client.
    // This module still links iOS test binaries against supabase-kt, so it keeps the Swift-runtime -L fix.
    val isMacHost = System.getProperty("os.name").orEmpty().startsWith("Mac")

    // Swift-interop link path (supabase 3.8.0+).
    //
    // supabase-kt 3.8.0 pulls dev.whyoleg.cryptography's CryptoKit provider, whose cinterop klib
    // is published with a HARDCODED Swift runtime search path of
    // `/Applications/Xcode.app/.../usr/lib/swift/iphonesimulator`. On any machine where Xcode is
    // installed under a versioned name (Xcode-26.5.0.app, Xcode-beta.app, /Volumes/..., or via
    // xcodes/asdf) that directory does not exist, so the swiftCompatibility* archives are never
    // found and linking dies with:
    //
    //   Undefined symbols: __swift_FORCE_LOAD_$_swiftCompatibility56
    //
    // The archives DO exist — just under the ACTIVE toolchain. Resolve that from `xcode-select -p`
    // at configuration time and add it as an explicit -L, so the build works regardless of where
    // Xcode lives. No-op when the directory is absent (non-Mac / no Xcode).
    val swiftRuntimeSearchPaths: Map<String, File> =
        runCatching {
            check(isMacHost) { "Apple toolchain lookup is macOS-only" }
            val developerDir =
                providers
                    .exec {
                        commandLine("xcode-select", "-p")
                    }.standardOutput.asText
                    .get()
                    .trim()
            val swiftLibRoot = File(developerDir, "Toolchains/XcodeDefault.xctoolchain/usr/lib/swift")
            mapOf(
                "iosSimulatorArm64" to File(swiftLibRoot, "iphonesimulator"),
                "iosArm64" to File(swiftLibRoot, "iphoneos"),
            ).filterValues { it.isDirectory }
        }.getOrDefault(emptyMap())

    targets.withType(org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget::class.java).configureEach {
        val swiftLibs = swiftRuntimeSearchPaths[name]
        if (swiftLibs != null) {
            binaries.all {
                linkerOpts("-L${swiftLibs.absolutePath}")
            }
        }
    }

    // macOS targets dropped 2026-07-24: Store5 (5.1.0-alpha08, the offline entitlement
    // cache from E4) publishes no macos_x64/macos_arm64 variant, so `commonMain`'s store5
    // dependency cannot resolve for macOS → "Compile All Targets" fails. macOS is not a
    // shipped PayCraft platform (native billing is Android/iOS per D13; the sample-app does
    // not target macOS; no consumer ships macOS). Re-add macosX64()/macosArm64() + src/macosMain
    // once Store5 ships macOS artifacts, or move store5 into a non-macOS intermediate source set.

    js {
        browser()
        nodejs()
    }

    wasmJs {
        browser()
    }

    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    sourceSets {
        // Members that cross the core/UI module boundary are public behind this opt-in (not public API).
        all { languageSettings.optIn("com.mobilebytelabs.paycraft.PayCraftInternalApi") }

        commonMain.dependencies {
            // All logic (config, pricing, identity, entitlement, checkout, persistence, `PayCraft`) — re-exported
            // so `implementation("io.github.mobilebytelabs:cmp-paycraft")` keeps compiling every app unchanged.
            api(project(":cmp-paycraft-core"))

            // Compose
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation(compose.components.resources)

            // Lottie for Compose Multiplatform. The SDK's terminal states (config unavailable /
            // offline) are the screens a user hits when billing is already broken — a bare line of
            // grey text there reads as a crash. `compottie-resources` lets the animation load from
            // this module's own composeResources, so it renders with NO network, which matters most
            // in exactly the offline case.
            implementation(paycraftLibs.compottie)
            implementation(paycraftLibs.compottie.resources)

            // Koin UI + ViewModel (core carries Koin core only)
            implementation(paycraftLibs.koin.core.viewmodel)
            implementation(paycraftLibs.koin.compose)
            implementation(paycraftLibs.koin.compose.viewmodel)

            // Lifecycle (ViewModel + collectAsStateWithLifecycle)
            implementation(paycraftLibs.jb.lifecycleViewmodel)
            // SavedStateHandle is referenced at LINK time by koin's ViewModel factory on Kotlin/Native.
            // Koin MUST match the lifecycle version Compose Multiplatform pulls (lifecycle 2.9.x, which
            // relocated SavedStateHandle to androidx.savedstate) — see the `koin = "4.1.0"` pin in
            // paycraftLibs.versions.toml. A koin built against lifecycle 2.8.x hits
            // `IrLinkageError: No class found for symbol androidx.lifecycle/SavedStateHandle` the moment
            // a viewModelOf(...) resolves (e.g. PayCraftPaywallViewModel on paywall open).
            implementation(paycraftLibs.jb.lifecycleViewmodelSavedState)
            implementation(paycraftLibs.jb.lifecycle.compose)

            // presentation/tree parses the dashboard's paywall tree JSON; "Renews today, 11:12 PM" labels.
            implementation(paycraftLibs.kotlinx.serialization.json)
            implementation(paycraftLibs.kotlinx.datetime)
        }

        commonTest.dependencies {
            implementation(paycraftLibs.kotlin.test)
            @OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)
            implementation(compose.uiTest)
            // ConfigClientTest — Ktor MockEngine for in-memory HTTP responses
            implementation("io.ktor:ktor-client-mock:3.1.1")
            // ConfigClientTest/ConfigCacheTest — coroutine test runner (runTest)
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
            // ConfigCacheTest — in-memory MapSettings (com.russhwolf.settings.MapSettings)
            implementation("com.russhwolf:multiplatform-settings-test:1.3.0")
        }

        val jvmTest by getting {
            dependencies {
                // Skiko native runtime — required for runComposeUiTest on the JVM target
                implementation(compose.desktop.currentOs)
                // Roborazzi Compose Desktop — device-free golden capture (AC-15). Scoped to
                // jvmTest ONLY: `roborazzi-compose-desktop` pulls Skiko-desktop transitively,
                // which is incompatible with js/wasm/ios compile, and Android AAR variants of
                // the plain `roborazzi` module. Keeping it in jvmTest keeps the publish clean
                // (nothing leaks into the six target artifacts) and matches the memory recipe.
                implementation(paycraftLibs.roborazzi.composeDesktop)
            }
        }
    }
}

mavenPublishing {
    signAllPublications()

    pom {
        name = "PayCraft"
        description =
            "Multi-provider KMP subscription billing — paycraft.mobilebytesensei.com SaaS. Stripe, Razorpay, and more."
        inceptionYear = "2026"
        url = "https://github.com/MobileByteLabs/PayCraft/"

        licenses {
            license {
                name = "The Apache License, Version 2.0"
                url = "https://www.apache.org/licenses/LICENSE-2.0.txt"
                distribution = "repo"
            }
        }

        developers {
            developer {
                id = "therajanmaurya"
                name = "Rajan Maurya"
                url = "https://github.com/therajanmaurya"
            }
        }

        scm {
            url = "https://github.com/MobileByteLabs/PayCraft/"
            connection = "scm:git:git://github.com/MobileByteLabs/PayCraft.git"
            developerConnection = "scm:git:ssh://git@github.com/MobileByteLabs/PayCraft.git"
        }
    }
}

// cmp-paycraft-core's immutable value types are stable for the paywall composables (see the file).
composeCompiler {
    stabilityConfigurationFiles.add(layout.projectDirectory.file("compose-stability.conf"))
}

compose.resources {
    publicResClass = true
    generateResClass = always
    packageOfResClass = "com.mobilebytelabs.paycraft.generated.resources"
}
