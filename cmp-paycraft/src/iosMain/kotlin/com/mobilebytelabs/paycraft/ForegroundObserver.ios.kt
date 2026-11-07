package com.mobilebytelabs.paycraft

import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.UIKit.UIApplicationWillEnterForegroundNotification
import kotlin.concurrent.AtomicInt

private val installed = AtomicInt(0)

/** StoreKit twin of Google's onResume sync: re-read Transaction.currentEntitlements on foreground. */
internal actual fun installForegroundObserver() {
    if (!installed.compareAndSet(0, 1)) return
    NSNotificationCenter.defaultCenter.addObserverForName(
        name = UIApplicationWillEnterForegroundNotification,
        `object` = null,
        queue = NSOperationQueue.mainQueue,
    ) { _ -> PayCraft.onAppForegrounded() }
}
