package com.mobilebytelabs.paycraft.sample.fake

import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import org.koin.dsl.module

/**
 * Overrides the SDK's network and storage with fakes, and NOTHING else.
 *
 * It used to also re-register `single<BillingManager> { PayCraftBillingManager(service, store) }`.
 * That was a stale duplicate of the SDK's own binding — which passes `repo` and more — and because
 * a later module wins in Koin, this test was exercising a manager constructed differently from the
 * one production builds. Dropping it means the fakes flow into the SDK's REAL wiring, which is what
 * an end-to-end test is for.
 *
 * It is also what lets `BillingManager` be internal: these two ARE the seams a consumer is meant to
 * substitute, and both are public facades.
 */
fun testPayCraftModule(fakeService: FakePayCraftService, fakeStore: FakePayCraftStore) = module {
    single<PayCraftService> { fakeService }
    single<PayCraftStore> { fakeStore }
}
