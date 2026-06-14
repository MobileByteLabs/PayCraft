package com.mobilebytelabs.paycraft.ui

/**
 * Visual shape of [PayCraftPaywall] inside a host screen.
 *
 * - [FullScreen] — default. The classic paywall takes the entire screen / bottom sheet.
 *   Pick this when the user has clicked an "Upgrade" CTA and you want their full attention.
 * - [Banner]     — a compact inline status strip that reflects the current [BillingState].
 *   Pick this for a persistent home-screen indicator that tells users they have a
 *   subscription (or are missing out on one) without interrupting the rest of the UI.
 *
 * Both modes share the same underlying [PayCraftPaywallViewModel] and observe the same
 * `BillingState` — switching between them is purely a presentation decision.
 */
enum class DisplayMode { Banner, FullScreen }
