plugins {
    alias(paycraftLibs.plugins.kotlinMultiplatform)
}

kotlin {
    jvm()
    sourceSets {
        commonMain.dependencies {
            implementation(paycraftLibs.koin.core)
            implementation(compose.runtime)
        }
    }
}
