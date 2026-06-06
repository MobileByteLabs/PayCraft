pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

// Migration tooling — composite build for the PayCraft v2 migration Gradle plugin
includeBuild("build-logic")

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "paycraft"
include(":cmp-paycraft")
include(":sample-app")
