package com.mobilebytelabs.paycraft.ui

object PayCraftTestTags {
    // Screen-level containers
    const val PAYWALL_SCREEN = "paycraft_paywall_screen"
    const val PAYWALL_CONTENT = "paycraft_paywall_content"
    const val PREMIUM_STATUS_SCREEN = "paycraft_premium_status_screen"

    // Loading / states
    const val LOADING_INDICATOR = "paycraft_loading_indicator"
    const val ERROR_MESSAGE = "paycraft_error_message"

    // Plan selection
    const val PLAN_SELECTOR_ROW = "paycraft_plan_selector_row"
    const val PLAN_CARD_PREFIX = "paycraft_plan_card_" // append plan.id
    const val PLAN_CARD_POPULAR_BADGE = "paycraft_plan_popular_badge"
    const val PLAN_CARD_PRICE = "paycraft_plan_card_price"
    const val PLAN_CARD_NAME = "paycraft_plan_card_name"
    const val PLAN_CARD_INTERVAL = "paycraft_plan_card_interval"

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
}
