package com.mobilebytelabs.paycraft

actual fun getPlatformName(): String = "JVM ${System.getProperty("java.version")}"
