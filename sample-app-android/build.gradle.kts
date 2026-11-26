// The Android app of the PayCraft sample. The UI is shared — `App()` lives in :sample-app's commonMain, which
// desktop, iOS and web run directly. AGP 9 does not allow com.android.application inside a Kotlin Multiplatform
// module, so the Android entry point (Application, Activity, manifest, BuildConfig, device tests) lives here.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
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
        //   ./gradlew :sample-app-android:installDebug \
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
    implementation(project(":sample-app"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)

    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.koin.test)
    androidTestImplementation(libs.koin.test.junit4)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.kotlin.test)
    androidTestImplementation(libs.junit)
    debugImplementation(libs.compose.ui.test.manifest)
}
