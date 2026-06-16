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
}

rootProject.name = "paycraft"
include(":cmp-paycraft")
include(":cmp-paycraft:preview-js")
include(":sample-app")
