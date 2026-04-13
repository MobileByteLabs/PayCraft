package com.mobilebytelabs.paycraft.persistence

import com.russhwolf.settings.Settings

class PayCraftSettingsStore : PayCraftStore {

    private val settings = Settings()

    override suspend fun saveEmail(email: String) {
        settings.putString(KEY_EMAIL, email)
    }

    override suspend fun getEmail(): String? {
        val email = settings.getStringOrNull(KEY_EMAIL)
        return if (email.isNullOrBlank()) null else email
    }

    override suspend fun clearEmail() {
        settings.remove(KEY_EMAIL)
    }

    companion object {
        private const val KEY_EMAIL = "paycraft_subscription_email"
    }
}
