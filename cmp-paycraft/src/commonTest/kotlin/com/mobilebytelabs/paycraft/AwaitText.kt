package com.mobilebytelabs.paycraft

import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

/**
 * The node showing [text], once it exists.
 *
 * String resources are read asynchronously; on js / wasmJs that is a fetch on the browser's single thread.
 * The blocking waitUntil* helpers spin that thread, so the fetch could never finish and the text stayed empty.
 * This waits by suspending: settle Compose, hand the event loop a real moment, look again — up to 5 s. On
 * jvm / iOS / Android the text is there on the first look.
 */
@OptIn(ExperimentalTestApi::class)
suspend fun ComposeUiTest.awaitText(
    text: String,
    substring: Boolean = false,
    ignoreCase: Boolean = false,
): SemanticsNodeInteraction {
    val matcher = hasText(text, substring = substring, ignoreCase = ignoreCase)
    val deadline = TimeSource.Monotonic.markNow() + 5.seconds
    while (onAllNodes(matcher).fetchSemanticsNodes().isEmpty()) {
        if (deadline.hasPassedNow()) {
            throw AssertionError(
                "'$text' never appeared. On screen:\n" + onRoot(useUnmergedTree = true).printToString(),
            )
        }
        awaitIdle()
        withContext(Dispatchers.Default) { delay(REAL_TIME_SLICE_MS) }
    }
    return onNodeWithText(text, substring = substring, ignoreCase = ignoreCase)
}

private const val REAL_TIME_SLICE_MS = 20L
