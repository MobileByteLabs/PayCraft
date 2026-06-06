plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
    gradlePluginPortal()
}

gradlePlugin {
    plugins {
        create("paycraftMigrateV2") {
            id = "com.mobilebytelabs.paycraft.migrate-v2"
            implementationClass = "PayCraftMigrateV2Plugin"
        }
    }
}
