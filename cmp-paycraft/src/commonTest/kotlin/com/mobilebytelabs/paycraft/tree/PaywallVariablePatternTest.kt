package com.mobilebytelabs.paycraft.tree

import com.mobilebytelabs.paycraft.presentation.tree.paywallVariablePatternSource
import com.mobilebytelabs.paycraft.presentation.tree.substituteVariables
import com.mobilebytelabs.paycraft.presentation.tree.PackagePrice
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Regression guard for a crash that 416 green JVM tests could not see.
 *
 * `PaywallVariables` compiled its pattern with a bare `}}`. The desktop JVM's `java.util.regex`
 * accepts a lone `}` as a literal; Android's engine rejects it, throwing `PatternSyntaxException`
 * from a STATIC INITIALIZER — so the app died with `ExceptionInInitializerError` the instant any
 * paywall tree rendered. Every JVM test still passed, because the JVM is the lenient one.
 *
 * Compiling the pattern here would therefore prove nothing. The SOURCE is what differs between the
 * two engines, so the source is what gets checked: every brace must be escaped, since this pattern
 * uses no quantifier braces at all.
 */
class PaywallVariablePatternTest {

    @Test
    fun pattern_has_no_unescaped_braces() {
        val src = paywallVariablePatternSource()
        var i = 0
        while (i < src.length) {
            val c = src[i]
            if (c == '{' || c == '}') {
                assertTrue(
                    i > 0 && src[i - 1] == '\\',
                    "unescaped '$c' at index $i of \"$src\" — the JVM tolerates it, Android throws " +
                        "PatternSyntaxException from the static initializer and the app dies opening " +
                        "the paywall",
                )
            }
            // Skip the character an escape applies to, so the backslash in `\{` is not itself read
            // as preceding the next character.
            i += if (c == '\\') 2 else 1
        }
    }

    @Test
    fun the_pattern_still_does_its_job() {
        // Escaping must not change behaviour — the guard above is worthless if the fix broke
        // substitution and nothing noticed.
        val price = PackagePrice(display = "$41.99", perPeriodNote = "per month", savingsPercent = 50)
        assertEquals("$41.99", substituteVariables("{{ product.price }}", price))
        assertEquals("SAVE 50%", substituteVariables("{{ product.offer_savings_label }}", price))
        assertEquals("", substituteVariables("{{ product.unknown }}", price))
        assertEquals("plain", substituteVariables("plain", price))
        // Braces that are not a variable are left alone rather than eaten.
        assertEquals("a { b } c", substituteVariables("a { b } c", price))
    }
}
