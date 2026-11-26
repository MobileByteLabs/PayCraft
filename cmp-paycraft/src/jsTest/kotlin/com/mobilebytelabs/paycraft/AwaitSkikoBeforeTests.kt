package com.mobilebytelabs.paycraft

import org.jetbrains.skiko.InternalSkikoApi
import org.jetbrains.skiko.wasm.awaitSkiko

/**
 * A Mocha root hook: no js test starts until skiko.wasm has loaded. runComposeUiTest does not wait for it, so
 * the first UI classes in a run (SinglePaywallPathTest, PaywallTemplateTest) drew before Skia existed and failed
 * with "Surface__1nMakeRasterN32Premul is not a function" while every later class passed.
 *
 * awaitSkiko is Skiko's own load promise (marked internal); this is test-only code, and if it moves the
 * compile error here says so.
 */
@OptIn(ExperimentalStdlibApi::class, InternalSkikoApi::class)
@EagerInitialization
@Suppress("unused")
private val awaitSkikoBeforeAnyTest: dynamic = js("before")({ awaitSkiko })
