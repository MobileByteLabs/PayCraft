plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
    alias(paycraftLibs.plugins.jetbrainsCompose)
}

kotlin {
    jvm()
    sourceSets {
        commonMain.dependencies {
            implementation(paycraftLibs.koin.core)
        }
    }
}
