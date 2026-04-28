package com.mobilebytelabs.paycraft.platform

actual fun currentTimeMillis(): Long = js("Date.now()").unsafeCast<Double>().toLong()
