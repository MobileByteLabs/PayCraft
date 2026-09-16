package com.mobilebytelabs.paycraft.billing

/**
 * The platform's DEFAULT native in-app-purchase client, or `null` when the
 * platform has no auto-wireable native store — in which case the caller falls
 * back to [WebCheckoutNativeBillingClient].
 *
 * This is the seam that makes native billing work with a **commonMain-only**
 * consumer integration. `PayCraftModule` binds
 * `platformDefaultNativeBillingClient() ?: WebCheckoutNativeBillingClient()`, so:
 *
 *  - **Android** → the real Google Play Billing v8 client, auto-wired from the
 *    Application context + foreground-Activity tracking that `PayCraftInitializer`
 *    already sets up. The consumer does NOT load `paycraftPlayBillingModule` or
 *    supply an activityProvider — just `PayCraft.initialize(apiKey)` in commonMain.
 *  - **iOS** → the real StoreKit 2 client. Its Swift shim is SDK-internal (compiled to a static
 *    archive, reached via cinterop), so `PayCraft.initialize(apiKey)` in commonMain is the whole
 *    integration — no Swift file to copy, no module to load, same as Android.
 *  - **web / desktop** → `null` → web checkout (correct: no native store exists).
 *
 * A consumer can still override the binding explicitly (e.g. a custom
 * activityProvider) by loading `paycraftPlayBillingModule` after `PayCraftModule`.
 */
expect fun platformDefaultNativeBillingClient(): NativeBillingClient?
