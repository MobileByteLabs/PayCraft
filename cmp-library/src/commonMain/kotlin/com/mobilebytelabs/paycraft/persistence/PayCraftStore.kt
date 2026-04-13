package com.mobilebytelabs.paycraft.persistence

interface PayCraftStore {
    suspend fun saveEmail(email: String)
    suspend fun getEmail(): String?
    suspend fun clearEmail()
}
