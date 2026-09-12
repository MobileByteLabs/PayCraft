package com.mobilebytelabs.paycraft.ui

object PayCraftTestTags {
    // Screen-level containers
    const val PAYWALL_SCREEN = "paycraft_paywall_screen"
    const val PAYWALL_CONTENT = "paycraft_paywall_content"

    /** The ModalBottomSheet hosting the paywall (PayCraftPaywallSheet) — owns scrim + chrome. */
    const val PAYWALL_SHEET = "paycraft_paywall_sheet"
    const val PREMIUM_STATUS_SCREEN = "paycraft_premium_status_screen"

    // Loading / states
    const val LOADING_INDICATOR = "paycraft_loading_indicator"
    const val ERROR_MESSAGE = "paycraft_error_message"

    /** BillingState.PaymentPending surface — store took the order, money has not cleared. */
    const val PAYMENT_PENDING = "paycraft_payment_pending"

    /** The "you don't need to buy again" line — the anti-duplicate-purchase guarantee. */
    const val PAYMENT_PENDING_REASSURANCE = "paycraft_payment_pending_reassurance"

    // Plan selection
    const val PLAN_SELECTOR_ROW = "paycraft_plan_selector_row"
    const val PLAN_CARD_PREFIX = "paycraft_plan_card_" // append plan.id
    const val PLAN_CARD_POPULAR_BADGE = "paycraft_plan_popular_badge"
    const val PLAN_CARD_PRICE = "paycraft_plan_card_price"
    const val PLAN_CARD_NAME = "paycraft_plan_card_name"
    const val PLAN_CARD_INTERVAL = "paycraft_plan_card_interval"
    const val PLAN_CARD_TRIAL_CHIP = "paycraft_plan_card_trial_chip"
    const val TRIAL_BANNER = "paycraft_trial_banner"

    // Benefits list
    const val BENEFITS_LIST = "paycraft_benefits_list"
    const val BENEFIT_ITEM_PREFIX = "paycraft_benefit_item_" // append index

    // Email input
    const val EMAIL_INPUT_SECTION = "paycraft_email_input_section"
    const val EMAIL_TEXT_FIELD = "paycraft_email_text_field"
    const val EMAIL_ERROR_TEXT = "paycraft_email_error_text"

    // Actions
    const val SUBSCRIBE_BUTTON = "paycraft_subscribe_button"
    const val LOGIN_BUTTON = "paycraft_login_button"
    const val LOGOUT_BUTTON = "paycraft_logout_button"
    const val MANAGE_SUBSCRIPTION_BUTTON = "paycraft_manage_subscription_button"
    const val CONTACT_SUPPORT_BUTTON = "paycraft_contact_support_button"
    const val REFRESH_BUTTON = "paycraft_refresh_button"
    const val DISMISS_BUTTON = "paycraft_dismiss_button"
    const val CLEAR_ERROR_BUTTON = "paycraft_clear_error_button"

    // Premium status card
    const val PREMIUM_STATUS_CARD = "paycraft_premium_status_card"
    const val PREMIUM_PLAN_LABEL = "paycraft_premium_plan_label"
    const val PREMIUM_EXPIRY_LABEL = "paycraft_premium_expiry_label"
    const val PREMIUM_RENEWAL_LABEL = "paycraft_premium_renewal_label"
    const val PREMIUM_PROVIDER_LABEL = "paycraft_premium_provider_label"
    const val PREMIUM_EMAIL_LABEL = "paycraft_premium_email_label"

    // Premium guard
    const val PREMIUM_GUARD_LOCKED = "paycraft_premium_guard_locked"
    const val PREMIUM_GUARD_UNLOCKED = "paycraft_premium_guard_unlocked"
    const val PREMIUM_GUARD_UPGRADE_BUTTON = "paycraft_premium_guard_upgrade_button"

    // Banner paywall (DisplayMode.Banner)
    const val BANNER_PAYWALL = "paycraft_banner_paywall"
    const val BANNER_LABEL = "paycraft_banner_label"

    // Phase 3 — Shimmer skeleton system (AC-5, AC-6, AC-14)
    /** Root tag on the paywall Loading-branch skeleton (PaywallSkeleton). */
    const val PAYWALL_SHIMMER = "paywall_shimmer"

    /** Root tag on the product-list Loading-branch skeleton (ProductListSkeleton). */
    const val PRODUCT_LIST_SHIMMER = "product_list_shimmer"

    /** Per-placeholder tag on each item inside ProductListSkeleton — count matches loaded items. */
    const val PRODUCT_LIST_ITEM_SHIMMER = "product_list_item_shimmer"

    /** Root tag on the compact banner Loading-branch shimmer strip. */
    const val BANNER_SHIMMER = "banner_shimmer"

    // Phase 3 — Product-list surface (AC-7)
    /** Root tag on the ProductList composable — the first-class plans surface. */
    const val PRODUCT_LIST = "product_list"

    /** Per-item tag on each product row inside ProductList. */
    const val PRODUCT_LIST_ITEM = "product_list_item"

    /** Tag on the trial-eligibility badge + microcopy shown above the CTA. */
    const val TRIAL_BADGE = "trial_badge"

    /**
     * Tag on the per-plan trial-terms line ("N-day free trial, then $X/interval")
     * rendered under a trial-eligible plan card. Play Subscriptions-policy
     * disclosure: names the post-trial price + billing cadence ON the offer itself.
     */
    const val PRODUCT_LIST_TRIAL_TERMS = "product_list_trial_terms"

    /** Tag on the single dominant paywall CTA button (ProductList.Continue). */
    const val PAYWALL_CTA = "paywall_cta"

    /** Tag on the "recommended" ring highlight — asserts exactly one recommended plan (AC-7). */
    const val PRODUCT_LIST_RECOMMENDED = "product_list_recommended"

    /** Tag on the annual-plan savings badge ("Save X%" vs monthly baseline). */
    const val SAVINGS_BADGE = "savings_badge"

    // ── Phase 3b — paywall-state assertion pairs (AC-28) ────────────────────────────────────
    // Each state's golden is paired with a NAMED assertion on one of these tags. A golden alone
    // proves a bitmap was written, not that the state rendered the thing that defines it — the
    // pair is what makes "the device-conflict screen exists" mean "it shows the conflicting
    // device and a way out".

    /** The account whose subscription is in conflict. */
    const val DEVICE_CONFLICT_EMAIL = "paycraft_device_conflict_email"

    /** The OTHER device holding the subscription — the fact the old two-line body discarded. */
    const val DEVICE_CONFLICT_DEVICE_NAME = "paycraft_device_conflict_device_name"


    /** Support address — the Gate 2 fallback for anyone OAuth cannot serve. */
    const val DEVICE_CONFLICT_SUPPORT_EMAIL = "paycraft_device_conflict_support_email"

    /** Resolution gate 1 — OAuth. */
    const val DEVICE_CONFLICT_GATE_OAUTH_GOOGLE = "paycraft_device_conflict_gate_oauth_google"
    const val DEVICE_CONFLICT_GATE_OAUTH_APPLE = "paycraft_device_conflict_gate_oauth_apple"

    /** Resolution gate 2 — emailed one-time code. */

    /** Resolution gate 3 — manual transfer via support. */
    const val DEVICE_CONFLICT_GATE_SUPPORT = "paycraft_device_conflict_gate_support"

    /**
     * Ownership-verified confirmation exits.
     *
     * There was an OWNERSHIP_VERIFIED_DIALOG tag here too, on a dialog wrapper no template ever
     * called — all four render the content inline. Unused public API that nobody can tell is unused
     * is a trap for the next reader, so both went.
     */
    const val OWNERSHIP_VERIFIED_CONFIRM = "paycraft_ownership_verified_confirm"
    const val OWNERSHIP_VERIFIED_CANCEL = "paycraft_ownership_verified_cancel"

    /** Empty-products surface — replaces a disabled CTA with an explanation and a way forward. */
    const val EMPTY_PRODUCTS_MESSAGE = "paycraft_empty_products_message"
    const val EMPTY_PRODUCTS_RETRY = "paycraft_empty_products_retry"

    /** Premium-arm entitlement operations. MANAGE_SUBSCRIPTION_BUTTON already exists — reused. */
    const val PAYWALL_RESTORE_BUTTON = "paycraft_paywall_restore_button"

    /** Phase 3a resilience surfaces, tagged here so AC-28 can pair all eleven states. */
    const val CONFIG_FAILED_MESSAGE = "paycraft_config_failed_message"
    const val CONFIG_FAILED_RETRY = "paycraft_config_failed_retry"

    /** The escape offered when the failure is NOT retryable — see ConfigUnavailable. */
    const val CONFIG_FAILED_DISMISS = "paycraft_config_failed_dismiss"

    /** Config is healthy but the tenant has no active plans — see PlansUnavailable. */
    const val NO_PLANS_MESSAGE = "paycraft_no_plans_message"
    const val NO_PLANS_DISMISS = "paycraft_no_plans_dismiss"
    const val OFFLINE_MESSAGE = "paycraft_offline_message"
    const val STALE_MESSAGE = "paycraft_stale_message"
    const val STALE_REFRESH = "paycraft_stale_refresh"
}
