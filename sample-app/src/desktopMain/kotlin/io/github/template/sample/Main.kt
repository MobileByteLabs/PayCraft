package com.mobilebytelabs.paycraft.sample

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "Library Sample",
    ) {
        App()
    }
}
