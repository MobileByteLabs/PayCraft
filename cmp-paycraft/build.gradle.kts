import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlinxSerialization)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.vanniktech.mavenPublish)
    // Roborazzi Gradle plugin — generates recordRoborazziJvm / verifyRoborazziJvm tasks
    // once `roborazzi-compose-desktop` is on the jvmTest classpath. Applied to :cmp-paycraft
    // only (AC-15 device-free golden gate for skeleton + Content paywall + ProductList).
    alias(libs.plugins.roborazzi)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("paycraft.version").get()

@OptIn(ExperimentalKotlinGradlePluginApi::class, ExperimentalWasmDsl::class)
kotlin {
    applyDefaultHierarchyTemplate()

    jvm()

    androidLibrary {
        namespace = "com.mobilebytelabs.paycraft"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        androidResources.enable = true
    }

    iosArm64()
    iosSimulatorArm64()

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
        commonMain.dependencies {
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
            implementation(libs.compottie)
            implementation(libs.compottie.resources)

            // Supabase
            implementation(libs.supabase.postgrest)
            implementation(libs.supabase.auth)
            implementation(libs.supabase.realtime)

            // Koin
            implementation(libs.koin.core)
            implementation(libs.koin.core.viewmodel)
            implementation(libs.koin.compose)
            implementation(libs.koin.compose.viewmodel)

            // Lifecycle (ViewModel + collectAsStateWithLifecycle)
            implementation(libs.lifecycle.viewmodel)
            // SavedStateHandle is referenced at LINK time by koin's ViewModel factory on Kotlin/Native.
            // Koin MUST match the lifecycle version Compose Multiplatform pulls (lifecycle 2.9.x, which
            // relocated SavedStateHandle to androidx.savedstate) — see the `koin = "4.1.0"` pin in
            // libs.versions.toml. A koin built against lifecycle 2.8.x hits
            // `IrLinkageError: No class found for symbol androidx.lifecycle/SavedStateHandle` the moment
            // a viewModelOf(...) resolves (e.g. PayCraftPaywallViewModel on paywall open).
            implementation(libs.lifecycle.viewmodel.savedstate)
            implementation(libs.lifecycle.runtime.compose)

            // Logging

            // Serialization
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.coroutines.core)

            // Settings (email persistence + offline entitlement SourceOfTruth — persistence/EntitlementDao.kt)
            implementation(libs.multiplatform.settings)

            // Store5 read-through cache for offline-correct entitlement gating (D8, AC9 —
            // persistence/EntitlementCache.kt + core/EntitlementRepository.kt).
            implementation(libs.store5)

            // SQLDelight SourceOfTruth: the offline SoT schema-of-record lives at
            //   src/commonMain/sqldelight/com/mobilebytelabs/paycraft/db/Entitlement.sq
            // The Store5 SoT is backed today by the multiplatform-settings SettingsEntitlementDao
            // (all six targets, process-death-durable). The SQLDelight code-gen plugin + per-platform
            // drivers (android-driver / native-driver / sqlite-driver) are wired alongside the native
            // StoreKit2/Play clients in Phase 3 (E3) — at which point SqlDelightEntitlementDao becomes
            // a drop-in EntitlementDao. Enable then with:
            //   plugins { alias(libs.plugins.sqldelight) }
            //   sqldelight { databases { create("PayCraftDb") {
            //     packageName.set("com.mobilebytelabs.paycraft.db") } } }
            //   implementation(libs.sqldelight.coroutines.extensions)
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.cio)
            implementation("androidx.security:security-crypto:1.1.0-alpha06")
            // androidx-startup hands the Application Context to PayCraftInitializer
            // before Application.onCreate runs — see PayCraftInitializer.kt.
            implementation("androidx.startup:startup-runtime:1.2.0")
            // Google Play Billing v8 — native Android IAP client (Phase 3, D8/D13).
            // PlayBillingNativeClient wraps BillingClient v9 (billing/NativeBillingClient.android.kt).
            implementation(libs.google.billing.ktx)
        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }

        jvmMain.dependencies {
            implementation(libs.ktor.client.cio)
        }

        jsMain.dependencies {
            implementation(libs.ktor.client.js)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
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
                implementation(libs.roborazzi.compose.desktop)
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

compose.resources {
    publicResClass = true
    generateResClass = always
    packageOfResClass = "com.mobilebytelabs.paycraft.generated.resources"
}
