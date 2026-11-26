package com.mobilebytelabs.paycraft.analytics

// The FailureText rules (commonMain), on the browser's own RegExp — same patterns, same order, same output. Kotlin's
// Regex.replace would add its group-reference substitution code to every page that loads paycraft-web (D16). Each
// function expression lives inside its function, so a bundle that never calls one does not carry it.

internal actual fun scrubFailureMessage(raw: String): String {
    val scrub: (String) -> String = js(
        """(function (s) {
          return s
            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]')
            .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
            .replace(/\b(?:pk|sk|rk|pcsk|whsec|rzp)_(?:live|test)_[A-Za-z0-9]{6,}|\b(?:sk|whsec|pcsk)_[A-Za-z0-9]{12,}/g, '[token]')
            .replace(/\+?\d[\d\s\-().]{6,}\d/g, '[number]')
            .replace(/\s+/g, ' ')
            .trim();
        })""",
    )
    return scrub(raw)
}

internal actual fun failureSlug(raw: String): String {
    val slug: (String) -> String = js(
        "(function (s) { return s.toLowerCase().replace(/[^a-z0-9_:.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown'; })",
    )
    return slug(raw)
}
