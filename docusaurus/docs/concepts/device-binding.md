---
sidebar_position: 2
---

# Device Binding

PayCraft includes built-in device registration to prevent subscription sharing across unlimited devices.

## How It Works

1. **App launches** -> calls `register_device(email, platform, deviceName)`
2. **Server issues** a `server_token` (UUID, tied to this device)
3. **All subsequent RPCs** use the `server_token` -- not the raw email
4. **One active device** per email at a time (configurable)

## Conflict Resolution

When a user logs in on a second device:

```
Device A: Active (has server_token_A)
Device B: Registers -> gets server_token_B (pending, is_active=false)
          -> BillingState.DeviceConflict emitted
          -> User verifies ownership (OAuth or OTP)
          -> transfer_to_device() activates B, revokes A
```

## Security Benefits

- **Server tokens** are generated server-side -- cannot be forged by clients
- **One-email-one-device** prevents casual subscription sharing
- **Token revocation** is instant -- revoked tokens return `token_valid: false`
