import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlinxSerialization)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.vanniktech.mavenPublish)
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

    iosX64()
    iosArm64()
    iosSimulatorArm64()

    macosX64()
    macosArm64()

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

            // Supabase
            implementation(libs.supabase.postgrest)
            implementation(libs.supabase.auth)

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
            implementation(libs.kermit)

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
            // PlayBillingNativeClient wraps BillingClient v8 (billing/NativeBillingClient.android.kt).
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
