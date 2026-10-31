package com.mobilebytelabs.paycraft

// No native store on this platform — nothing to re-sync on foreground.
internal actual fun installForegroundObserver() = Unit
