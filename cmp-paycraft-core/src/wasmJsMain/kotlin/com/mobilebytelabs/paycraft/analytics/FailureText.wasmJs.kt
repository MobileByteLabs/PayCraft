package com.mobilebytelabs.paycraft.analytics

internal actual fun scrubFailureMessage(raw: String): String = FailureText.scrub(raw)

internal actual fun failureSlug(raw: String): String = FailureText.slug(raw)
