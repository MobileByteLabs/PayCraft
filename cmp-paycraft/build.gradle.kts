import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import java.util.Base64
import java.util.Properties

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlinxSerialization)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.vanniktech.mavenPublish)
    id("signing")
}

// Load signing credentials from .env (never hardcoded, never override)
val envFile = rootProject.file(".env")
val envProps =
    Properties().also { props ->
        if (envFile.exists()) envFile.reader().use { props.load(it) }
    }

fun envOrProp(
    envKey: String,
    propKey: String = envKey,
) = envProps.getProperty(envKey) ?: findProperty(propKey)?.toString() ?: System.getenv(envKey) ?: ""

val signingKeyId = envOrProp("PAYCRAFT_SIGNING_KEY_ID", "signingInMemoryKeyId")
val signingKey = envOrProp("PAYCRAFT_GPG_KEY_CONTENTS", "signingInMemoryKey")
val signingPassword = envOrProp("PAYCRAFT_SIGNING_PASSWORD", "signingInMemoryKeyPassword")
val mcUsername = envOrProp("PAYCRAFT_MAVEN_CENTRAL_USERNAME", "mavenCentralUsername")
val mcPassword = envOrProp("PAYCRAFT_MAVEN_CENTRAL_PASSWORD", "mavenCentralPassword")

// Inject Maven Central credentials as project properties for vanniktech
if (mcUsername.isNotBlank()) {
    ext["mavenCentralUsername"] = mcUsername
    ext["mavenCentralPassword"] = mcPassword
}

group = "io.github.mobilebytelabs"

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
            implementation(libs.lifecycle.runtime.compose)

            // Logging
            implementation(libs.kermit)

            // Serialization
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.coroutines.core)

            // Settings (email persistence)
            implementation(libs.multiplatform.settings)
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.cio)
            implementation("androidx.security:security-crypto:1.1.0-alpha06")
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
        }
    }
}

mavenPublishing {
    publishToMavenCentral()
    if (signingKey.isNotBlank()) signAllPublications()

    pom {
        name = "PayCraft"
        description = "Self-hosted, multi-provider billing library for KMP apps. Stripe, Razorpay, and more."
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

// Inject in-memory signatory into all Sign tasks after everything is evaluated
// PAYCRAFT_GPG_KEY_CONTENTS is base64(ASCII-armored PGP key)
if (signingKey.isNotBlank()) {
    val decodedKey = String(Base64.getDecoder().decode(signingKey))
    gradle.projectsEvaluated {
        val signatoryProvider =
            org.gradle.plugins.signing.signatory.pgp
                .PgpSignatoryProvider()
        signing {
            useInMemoryPgpKeys(signingKeyId, decodedKey, signingPassword)
        }
        tasks.withType<Sign>().configureEach {
            val ext = project.extensions.getByType<SigningExtension>()
            val s = ext.signatory
            if (s != null) setSignatory(s)
        }
    }
}

compose.resources {
    publicResClass = true
    generateResClass = always
    packageOfResClass = "com.mobilebytelabs.paycraft.generated.resources"
}
