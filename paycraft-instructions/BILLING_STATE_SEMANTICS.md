example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

# BILLING_STATE_SEMANTICS.md — the billing state machine and realtime invalidation

> Consumed by `/idea-paycraft` chain steps 6–7. Authored by `/paycraft-dev fold`.

## `sealed interface BillingState`

| Arm | Terminal? | Meaning | UI obligation |
|---|:--:|---|---|
| `Loading` | no | A refresh or purchase is in flight | Skeleton/spinner; never a blank frame |
| `Free` | yes | No entitlement — includes "user cancelled the purchase" | Show the paywall/CTA |
| `Premium(status, trial?)` | yes | Active or trialing. `trial != null` ⇒ inside the free-trial window | Unlock; trial-specific copy when `trial != null` |
| `PaymentPending(productId)` | no (async) | Store accepted the order, money has not cleared | "Payment processing" — **no retry button** |
| `Error(message)` | yes | Failure, or a blocked misconfigured native checkout | Show the message + a safe retry |
| `DeviceConflict(...)` | no | Entitlement is bound to another active device | Run the gate ladder below |
| `OwnershipVerified(...)` | no | Ownership proven, transfer not yet executed | **Explicit confirmation**, then `confirmDeviceTransfer()` |

One state machine renders all seven arms for every bundled surface: `PaywallStateHost`. The four
Kotlin templates that each carried their own copy of this `when` are gone (PAYWALL_CUSTOMIZATION.md).

### `PaymentPending` is the arm integrations get wrong

It corresponds to Play `PurchaseState.PENDING` (cash, UPI mandate, family Ask-to-Buy) and StoreKit
`.pending` (Ask to Buy, SCA). It is **not** an error and **not** premium. Resolution is asynchronous
and can take days; it arrives on `NativeBillingClient.purchaseUpdates`. Rendering it as an error tells
a buyer their payment failed while the store is still processing it, and is a common cause of
duplicate purchases — which is why the bundled `PaymentPendingContent` deliberately offers no retry.

### `Free` covers cancellation

A user who dismisses the store sheet lands in `Free`, not `Error`. A paywall that shows an error
toast on every dismissal is misreading this arm.

### `Free` is also the answer for an unconfigured SDK

Resolving `BillingManager` before `PayCraft.initialize` no longer throws — `PayCraftService` holds a
nullable api key, the RPCs resolve no tenant, and the honest answer is Free (WIRING_CONTRACTS.md). A
host that wants to distinguish "no entitlement" from "no key" asks `PayCraft.isConfigured`; a host
that simply gates features needs no branch at all.

## Device-conflict gate ladder

```
DeviceConflict
  ├─ Gate 1  loginWithOAuth(GOOGLE|APPLE, idToken)   ← the only self-service proof
  └─ Gate 2  manual — prefilled "Contact Support" to DeviceConflict.supportEmail
        ↓ (Gate 1 succeeds)
OwnershipVerified(verifiedVia = OAUTH)
        ↓ user explicitly confirms "deactivate <device> and transfer here"
confirmDeviceTransfer()  →  Premium | Error
```

The host app triggers the platform OAuth flow and passes the resulting ID token; the SDK verifies it
via Supabase Auth and extracts the verified email. Skipping the confirmation between
`OwnershipVerified` and `confirmDeviceTransfer()` silently deactivates someone's other device.

> **The emailed one-time-code gate was REMOVED on 2026-09-06** — along with the `otp-send-hook` edge
> function, the `requestOtpVerification` / `verifyOtp` / `verifyOtpOwnership` methods, and the `OTP`
> entry in `VerificationMethod` (now a single-entry enum, `OAUTH`). State the cost plainly rather
> than reading the diff as a simplification: OTP was the **only** self-service route for a
> custom-domain email that cannot be linked to a Google or Apple account, so those buyers now reach
> Gate 2 — a human — instead of resolving a device conflict themselves. An integration that still
> renders an OTP field is showing a control nothing can satisfy, and one that still calls those
> methods will not compile.

## Companion flows

- `isPremium: StateFlow<Boolean>` — the coarse gate most feature code should read.
- `subscriptionStatus: StateFlow<SubscriptionStatus>` — `isPremium`, `plan`, `email`, `provider`,
  `expiresAt`, `willRenew`.
- `isInTrial` / `trialEndsAt` — flat projections of `Premium.trial` for direct `collectAsState()`.
- `subscriptionActivated: SharedFlow<SubscriptionActivated>` — rising edge only, **replay 0**.

## Canonical server-side states

Entitlement reconciliation maps every provider's vocabulary onto one canonical set:
`active`, `active_non_renewing`, `trialing`, `grace` / `in_grace_period`, `on_hold`,
`billing_retry` / `on_billing_retry`, `cancelled` / `canceled`, `expired`, `non_renewing`.
`grace`, `on_hold` and `billing_retry` are **still-entitled-or-recovering** states — an integration
that treats anything other than `active`/`trialing` as "not premium" will revoke access from users
whose card is merely retrying.

## Config resilience — four answers, not one nullable

`PayCraft.configResultFlow` distinguishes `Fresh` / `Cached` / `Stale(ageSeconds)` / `Bundled` /
`BuiltIn` / `Failed(reason)` / `Loading`, where `suiteConfigFlow` could only say null. That
distinction is what an offline buyer needs: a `Stale` config renders real plans with an age notice,
a `Failed(OFFLINE)` is retryable, and `Failed(DECODE_ERROR)` / `Failed(NOT_INITIALIZED)` are **not**
(`isRetryable == false`) because a retry cannot fix a malformed payload or a billing stack that was
never started. Offering "Try again" there teaches the buyer that retry does nothing.

## Refresh and sync policy

`refreshStatus(force = false)` honours `SyncPolicy` (tiered weekly/daily/hourly) and skips the network
call while the local cache is fresh. Pass `force = true` after returning from a checkout, where server
state has just changed. `EntitlementCache` (Store5) supplies offline last-known-good so a cold or
offline start renders real entitlement rather than a spinner. `SuiteConfig.cacheTtlSeconds` defaults
to **300** (5 minutes) and the SERVER's value wins — the client default exists only for a payload
that omits the field, and matches the server's so the two cannot drift on how stale a device may be.

## Realtime invalidation

DB triggers broadcast a lightweight **invalidation ping** — never row data — on two public channels:

| Channel | Event | Effect |
|---|---|---|
| `config:{tenantId}` | `config_changed` | refetch `/config` (product/pricing/paywall edits land without a release) |
| `entitlement:{tenantId}:{appUserId}` | `entitlement_changed` | `refreshStatus(force = true)` |

Because the payload carries no secrets, the channels are safe to be public. Operational rules:

- Subscribe only once `tenantId` is known.
- Re-subscribe the entitlement channel when `appUserId` flips from device-id to email.
- `resubscribe()` on foreground; `stop()` on logout.
- Liveness is the channel's subscribed status, not `channel != null` — a dead channel stays non-null
  and every later `ensure*` call no-ops against it, so realtime silently stops.

**Degraded is acceptable, silent is not.** If realtime cannot subscribe, the SDK still converges via
the TTL/foreground refresh path. `/idea-paycraft` reports `realtime: degraded` with the reason rather
than asserting a green subscription it did not observe.
