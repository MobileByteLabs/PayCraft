rootProject.name = "paycraft-sample-cloud"
include(":composeApp")

pluginManagement {
    repositories {
        google(); mavenCentral(); gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google(); mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}
