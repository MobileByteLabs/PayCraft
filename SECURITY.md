# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.4.x   | Yes       |
| < 1.4   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in PayCraft, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email **security@mobilebytelabs.io** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
3. You will receive acknowledgment within **48 hours**.
4. We will provide a fix timeline within **5 business days**.

## Security Architecture

PayCraft uses a defense-in-depth approach:

| Layer | Protection |
|-------|-----------|
| **Transport** | HTTPS/TLS for all Supabase + webhook traffic |
| **Authentication** | Server-token architecture — RPCs require `server_token` (not raw email) |
| **Tenant Isolation** | RLS policies restrict all direct table access to `service_role` only |
| **Webhook Integrity** | Stripe signature verification with mode-specific secrets (no fallback) |
| **Local Storage** | Android: AES-256-GCM EncryptedSharedPreferences; iOS: Data Protection |
| **Logging** | Email redaction in all debug output (`r***@gmail.com`) |

## Credential Handling

- **Supabase Anon Key**: Public, embedded in client apps. Cannot access tables directly (RLS blocks all). Can call RPCs but requires valid `server_token`.
- **Supabase Service Role Key**: Never exposed to clients. Used only in Edge Functions (server-side).
- **Stripe Keys**: Stored in Supabase Edge Function secrets. Never in client code.
- **Server Token**: Generated server-side via `register_device()`. Tied to specific email + device. Stored in platform-encrypted storage.

## What a Stolen Anon Key Gets You

Even with the Supabase anon key:
- Cannot read `subscriptions` table directly (RLS: `service_role` only)
- Cannot read `registered_devices` table directly (RLS: `service_role` only)
- Can call RPCs, but every RPC requires a valid `server_token`
- Cannot enumerate emails (no email-based RPCs)
- Cannot forge webhooks (signature verification with per-mode secrets)
