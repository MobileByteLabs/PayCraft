package com.mobilebytelabs.paycraft.platform

import kotlin.js.JsNumber

@JsFun("() => Date.now()")
private external fun dateNow(): JsNumber

actual fun currentTimeMillis(): Long = dateNow().toDouble().toLong()
