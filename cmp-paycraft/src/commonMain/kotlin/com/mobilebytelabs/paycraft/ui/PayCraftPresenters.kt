/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.mobilebytelabs.paycraft.PayCraft

/**
 * The SDK's own presentation of the paywall and the restore sheet.
 *
 * ## Owning it, not signalling it
 *
 * [PayCraft.presentPaywall] only flips [PayCraft.paywallPresentation], a flow the host has to
 * observe and render. Most hosts do not — cappy, the first consumer, never reads it at all — so a
 * surface that merely CALLS it absorbs the tap into nothing. [PayCraftSoftGate] already learned this
 * and renders its own sheet; these presenters are that lesson applied to every other surface, so an
 * Upgrade or Restore affordance the SDK draws is one the SDK can actually complete.
 *
 * `presentPaywall()` is still called, for the analytics and state trigger other SDK surfaces read.
 *
 * ## Why a composable that returns a lambda
 *
 * A sheet has to be EMITTED somewhere in the tree, and the state driving it has to outlive the tap.
 * Returning the trigger from the same call that emits the sheet keeps both in one place, so a caller
 * writes two lines instead of owning a `var showRestore` and remembering to render the sheet:
 *
 * ```kotlin
 * val showRestore = rememberRestorePresenter()
 * TextButton(onClick = showRestore) { Text(copy.restoreLabel) }
 * ```
 *
 * This is the shape that let [PayCraftRestore] become internal: a host no longer places the sheet,
 * so it no longer needs to name it.
 */
@Composable
internal fun rememberRestorePresenter(): () -> Unit {
    var visible by remember { mutableStateOf(false) }
    // Emitted unconditionally; PayCraftRestore itself returns early when not visible, BEFORE
    // resolving anything from Koin. That early return is what keeps a @Preview of a host screen
    // containing one from needing a started graph.
    PayCraftRestore(visible = visible, onDismiss = { visible = false })
    return remember { { visible = true } }
}

/** The paywall half. See [rememberRestorePresenter] for why this owns presentation. */
@Composable
internal fun rememberPaywallPresenter(): () -> Unit {
    var visible by remember { mutableStateOf(false) }
    PayCraftSheet(visible = visible, onDismiss = { visible = false })
    return remember {
        {
            // Both: the flow for anything observing it, and the sheet for the user who tapped.
            PayCraft.presentPaywall()
            visible = true
        }
    }
}
