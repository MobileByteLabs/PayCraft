plugins {
    kotlin("multiplatform")
    id("com.android.library")
    id("maven-publish")
}

kotlin {
    androidTarget()
    iosX64()
    iosArm64()
    iosSimulatorArm64()
    jvm("desktop")
    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs { browser() }

    sourceSets {
        commonMain.dependencies {
            // PayCraft SDK — provides PaymentProvider, ProviderPlugin, PluginConfig
            implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

android {
    namespace = "com.example.paycraft.yourgateway"
    compileSdk = 34
    defaultConfig { minSdk = 24 }
}

// Publishing config — fill in your coordinates
group = "com.example"
version = "1.0.0"
