/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.ui

/**
 * How [PayCraftBanner] presents itself.
 *
 * ## Why these were two components
 *
 * `PayCraftBanner` and `PayCraftPremiumBanner` were separate public composables that did the same
 * job: observe entitlement, render a card, offer upgrade and restore. A consumer choosing between
 * them had to read both to discover that the real difference was what happens to a PAYING user —
 * one shows them their subscription, the other disappears.
 *
 * That is a style, not a component. Merging them means one name to learn and one place where a fix
 * lands, the same reasoning that gave [PayCraftSubscriptionSettings] its five presets.
 *
 * ## Two presets, not five
 *
 * [PayCraftSubscriptionSettings] offers five because a settings row has five genuinely different
 * densities. A banner has two real behaviours, so there are two. Adding `Compact` or `Hero` here
 * because the other component has them would be inventing variants nothing asked for.
 *
 * Each preset bundles premium-behaviour AND visual weight rather than exposing them as independent
 * axes, because the four combinations are not all sensible: a rich gradient card that vanishes for
 * subscribers wastes the most prominent surface on the screen, and a flat compact card is a poor
 * place to show renewal dates and support contact.
 */
enum class PayCraftBannerStyle {
    /**
     * Rich gradient card that adapts: perks and a gold upgrade CTA for a free user, plan details,
     * renewal date and a Manage action for a subscriber.
     *
     * The default, and the right one for a dedicated billing area — a settings screen's
     * subscription section, an account tab. A subscriber gets something useful rather than a gap.
     *
     * While a KNOWN subscriber's status is refreshing it dims and shows a spinner over the last
     * stable card, instead of flashing the free card at someone who is paying.
     */
    Adaptive,

    /**
     * Flat brand-coloured upsell that renders NOTHING for a subscriber.
     *
     * For a banner placed among unrelated content — the top of a feed, above a settings list — where
     * a paying user should see no billing UI at all rather than a status card they did not come for.
     * Never nag someone who already bought.
     *
     * Before entitlement is known it shows a layout-matched shimmer rather than an upgrade card, so
     * a subscriber never sees "Get Premium" flash on cold start.
     */
    Upsell,
}
