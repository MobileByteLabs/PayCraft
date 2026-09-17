pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }

    // A SECOND catalog over the same TOML, under a name no consumer will ever own.
    //
    // `cmp-paycraft` is meant to be consumable as SOURCE (an app can include it directly rather than
    // via Maven). A build script's bare `libs` resolves against whatever build is EVALUATING it, so a
    // source-consumed module silently reads the CONSUMER's catalog — which means the consumer has to
    // carry an alias for every dependency this SDK uses (Play Billing, supabase-realtime, a Maven
    // publishing plugin…), none of which the consuming app itself needs. That is dependency pollution
    // that grows with every dependency added here.
    //
    // `paycraftLibs` is resolved by NAME, so `cmp-paycraft/build.gradle.kts` reads THIS file whichever
    // build evaluates it. A consumer registers one catalog instead of merging ~34 aliases, and the
    // SDK keeps its own versions — notably roborazzi 1.73.0, which must not silently downgrade to a
    // consumer's 1.67.0 (the 14 goldens depend on it).
    //
    // The default `libs` stays for the sample apps, which are only ever built here.
    versionCatalogs {
        create("paycraftLibs") {
            from(files("gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "paycraft"
include(":cmp-paycraft")
include(":sample-app")
