# Changelog

## [1.4.0] - 2026-04-28

### Added
- **Smart sync cache-first billing** — `PayCraftBillingManager` now reads cached `SubscriptionStatus` synchronously in `init`, eliminating the `Loading` flash on app launch. Supabase is only called when the cache is stale or missing.
- **`SyncPolicy`** — tiered sync intervals based on subscription state:
  - Weekly: premium with >7 days to expiry
  - Daily: free users, cancelled subscriptions, or 1-7 days to expiry
  - Hourly: <24 hours to expiry (catches renewals/expirations quickly)
- **`refreshStatus(force: Boolean = false)`** — new parameter on `BillingManager.refreshStatus()`. Default (`false`) respects `SyncPolicy`; pass `true` to always fetch from Supabase (e.g., post-checkout polling).
- **`PayCraftStore` cache methods** — `cacheSubscriptionStatus()`, `getCachedSubscriptionStatus()`, `getLastSyncedAt()`, `clearCache()` with default no-op implementations for backward compatibility.
- **`PayCraftSettingsStore` cache persistence** — cached status stored via `multiplatform-settings` (survives app restarts).
- **`currentTimeMillis()` expect/actual** — KMP time provider for Android, JVM, iOS, macOS, JS, and WasmJS.

### Changed
- `refreshStatus()` default behavior changed from always-fetch to smart sync. This is source-compatible but a **behavioral change**.
- `logOut()` and `revokeCurrentDevice()` now clear the subscription cache.
- `applyPremiumResult()` now writes to cache after every successful Supabase sync.

### Migration Guide
If your app calls `refreshStatus()` after a payment checkout (e.g., returning from Stripe), update to:
```kotlin
billingManager.refreshStatus(force = true)
```
All other call sites (init, ON_RESUME, screen transitions) work correctly with the new smart sync default.

## [1.3.0] - 2026-04-27

### Added
- Device conflict resolution (OAuth Gate 1 + OTP Gate 2)
- `confirmDeviceTransfer()` for explicit user-confirmed transfers
- `OwnershipVerified` billing state with verification method tracking
- Comprehensive `PayCraftLogger` debug logging
