---
sidebar_position: 3
---

# Smart Sync

PayCraft uses a tiered cache policy to minimize network calls while keeping subscription status fresh.

## Sync Tiers

| Subscription State | Sync Interval | Rationale |
|-------------------|---------------|-----------|
| No subscription | Weekly | Unlikely to change frequently |
| Active, auto-renew | Daily | Stable -- just needs periodic refresh |
| Active, will cancel | Every 4 hours | May change soon (resubscribe) |
| Expired/past_due | Hourly | User likely trying to fix payment |

## How It Works

```kotlin
// On app launch:
1. Read cached status from local storage (instant -- no network)
2. Show cached UI immediately (no loading spinner)
3. Check if sync is due (based on tier above)
4. If due: fetch from Supabase in background
5. Update UI if status changed
```

## Force Refresh

After returning from a payment checkout, force a sync:

```kotlin
billingManager.refreshStatus(force = true)
```

This bypasses the tier policy and always hits Supabase.
