import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.targets.js.webpack.KotlinWebpackConfig

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrainsCompose)
    alias(libs.plugins.compose.compiler)
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
        }
    }

    jvm("desktop")

    listOf(
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "SampleApp"
            isStatic = true
        }
    }

    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName = "sampleApp"
        browser {
            val rootDirPath = project.rootDir.path
            val projectDirPath = project.projectDir.path
            commonWebpackConfig {
                outputFileName = "sampleApp.js"
                devServer =
                    (devServer ?: KotlinWebpackConfig.DevServer()).apply {
                        static =
                            (static ?: mutableListOf()).apply {
                                add(rootDirPath)
                                add(projectDirPath)
                            }
                    }
            }
        }
        binaries.executable()
    }

    sourceSets {
        val desktopMain by getting

        androidMain.dependencies {
            implementation(libs.androidx.activity.compose)
            implementation(libs.koin.android)
        }

        val androidInstrumentedTest by getting {
            dependencies {
                implementation(libs.compose.ui.test.junit4)
                implementation(libs.koin.test)
                implementation(libs.koin.test.junit4)
                implementation(libs.kotlinx.coroutines.test)
                implementation(libs.junit)
            }
        }

        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation(compose.components.uiToolingPreview)

            // Include the library
            implementation(project(":cmp-paycraft"))

            // Koin (not transitive from cmp-paycraft)
            implementation(libs.koin.core)
            implementation(libs.koin.compose)
        }

        desktopMain.dependencies {
            implementation(compose.desktop.currentOs)
        }
    }
}

android {
    namespace = "com.mobilebytelabs.paycraft.sample"
    compileSdk =
        libs.versions.android.compileSdk
            .get()
            .toInt()

    defaultConfig {
        applicationId = "com.mobilebytelabs.paycraft.sample"
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.targetSdk
                .get()
                .toInt()
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Point the sample at a REAL backend instead of its offline mock:
        //   ./gradlew :sample-app:installDebug \
        //     -PpaycraftBaseUrl=http://10.0.2.2:54321 -PpaycraftApiKey=pk_test_…
        //   (the Supabase ROOT — SelfHosted appends /functions/v1/config itself)
        // Unset (the default) keeps PayCraftBackend.Mock, so the showcase still runs with no
        // network and no dashboard — which is what makes it a showcase.
        buildConfigField(
            "String",
            "PAYCRAFT_BASE_URL",
            "\"${project.findProperty("paycraftBaseUrl") ?: ""}\"",
        )
        buildConfigField(
            "String",
            "PAYCRAFT_API_KEY",
            "\"${project.findProperty("paycraftApiKey") ?: "pk_test_sample"}\"",
        )
        // Read from the environment rather than a -P property so the value stays out of shell
        // history and process listings.
        buildConfigField(
            "String",
            "PAYCRAFT_ANON_KEY",
            "\"${System.getenv("PAYCRAFT_ANON_KEY") ?: ""}\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    debugImplementation(libs.compose.ui.test.manifest)
}

compose.desktop {
    application {
        mainClass = "com.mobilebytelabs.paycraft.sample.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "com.mobilebytelabs.paycraft.sample"
            packageVersion = "1.0.0"
        }
    }
}
