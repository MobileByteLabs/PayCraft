package com.mobilebytelabs.paycraft.tree

import androidx.compose.ui.graphics.Color
import com.mobilebytelabs.paycraft.presentation.tree.treeColorOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TreeColorTest {

    @Test
    fun eight_digit_tree_colour_is_rrggbbaa_not_aarrggbb() {
        // The exact value RevenueCat authors for a title. Read as AARRGGBB this is alpha 0x01 —
        // invisible text that looks like missing content.
        val c = treeColorOrNull("#010101ff")!!
        assertEquals(1f, c.alpha, 0.01f, "opaque: the trailing ff is ALPHA, not blue")
        assertTrue(c.red < 0.02f && c.green < 0.02f && c.blue < 0.02f, "near-black")
    }

    @Test
    fun translucent_white_keeps_its_alpha() {
        val c = treeColorOrNull("#FFFFFFcc")!!
        assertEquals(1f, c.red, 0.01f)
        assertEquals(0.8f, c.alpha, 0.02f)
    }

    @Test
    fun six_digit_is_opaque_passthrough() {
        val c = treeColorOrNull("#6750A4")!!
        assertEquals(1f, c.alpha, 0.01f)
    }

    @Test
    fun malformed_returns_null_so_the_caller_can_fall_back_to_the_theme() {
        assertNull(treeColorOrNull(null))
        assertNull(treeColorOrNull(""))
        assertNull(treeColorOrNull("#12345"))
        assertNull(treeColorOrNull("not-a-colour"))
    }
}
