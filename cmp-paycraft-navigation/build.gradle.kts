/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * `cmp-paycraft-navigation` — the paywall as a Navigation Compose destination.
 *
 * ## Why a SEPARATE artifact
 *
 * The paywall is sometimes a STEP in a host's flow (onboarding "start free trial"), not a reaction
 * to locked content — and a step needs a route, a nav extension and a place in the graph. Every
 * consumer was writing those by hand.
 *
 * It cannot live in `:cmp-paycraft` because that would put `navigation-compose` on the compile
 * classpath of every consumer, including the ones using Voyager, Decompose, or their own router.
 * A billing SDK does not get to pick an app's navigation library.
 *
 * So: opt in by adding this dependency. Apps that present the paywall only through gates and
 * banners — the common case — never see it. Same split as `cmp-network-monitor-compose` and
 * `cmp-supabase-auth-compose` elsewhere in this org.
 *
 * Targets are a SUBSET of the core artifact's on purpose: Navigation Compose publishes for
 * android / jvm / ios / js / wasmJs, and this module follows exactly that set rather than
 * declaring targets it cannot resolve a dependency for.
 */

import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
    alias(paycraftLibs.plugins.android.kmp.library)
    alias(paycraftLibs.plugins.kotlin.serialization)
    alias(paycraftLibs.plugins.jetbrainsCompose)
    alias(paycraftLibs.plugins.compose.compiler)
    alias(paycraftLibs.plugins.vanniktech.mavenPublish)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("paycraft.version").get()

@OptIn(ExperimentalKotlinGradlePluginApi::class, ExperimentalWasmDsl::class)
kotlin {
    applyDefaultHierarchyTemplate()
    jvm()
    android {
        namespace = "com.mobilebytelabs.paycraft.navigation"
        compileSdk =
            paycraftLibs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            paycraftLibs.versions.android.minSdk
                .get()
                .toInt()
    }
    iosArm64()
    iosSimulatorArm64()
    js { browser() }
    wasmJs { browser() }

    sourceSets {
        commonMain.dependencies {
            // `api`, not `implementation`: a consumer calling `payCraftPaywallDestination` is
            // writing against NavGraphBuilder, and PayCraftPaywall appears in its own call. Both
            // types must be on their compile classpath or the extension is unusable.
            api(project(":cmp-paycraft"))
            api(paycraftLibs.jb.composeNavigation)

            implementation(compose.runtime)
            implementation(compose.foundation)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(paycraftLibs.kotlinx.serialization.json)
        }
    }
}

mavenPublishing {
    signAllPublications()
    pom {
        name = "PayCraft Navigation"
        description =
            "Navigation Compose destination for the PayCraft paywall — route, nav extension, and " +
            "purchase-aware dismissal. Optional companion to cmp-paycraft."
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
                id = "mobilebytelabs"
                name = "MobileByteLabs"
                url = "https://github.com/MobileByteLabs/"
            }
        }
        scm {
            url = "https://github.com/MobileByteLabs/PayCraft/"
            connection = "scm:git:git://github.com/MobileByteLabs/PayCraft.git"
            developerConnection = "scm:git:ssh://git@github.com/MobileByteLabs/PayCraft.git"
        }
    }
}
