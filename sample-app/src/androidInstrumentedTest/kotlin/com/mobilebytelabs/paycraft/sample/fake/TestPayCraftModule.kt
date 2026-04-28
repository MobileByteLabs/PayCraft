package com.mobilebytelabs.paycraft.sample.fake

import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import org.koin.dsl.module

fun testPayCraftModule(fakeService: FakePayCraftService, fakeStore: FakePayCraftStore) = module {
    single<PayCraftService> { fakeService }
    single<PayCraftStore> { fakeStore }
    single<BillingManager> { PayCraftBillingManager(service = get(), store = get()) }
}
