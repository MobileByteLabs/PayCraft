-- Migration 005: Server-owned device registry
-- Each row = one device registered for a subscription email.
-- At most one row per email may have is_active = true at any time.

CREATE TABLE IF NOT EXISTS registered_devices (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL,
    device_token  TEXT        NOT NULL UNIQUE,
    platform      TEXT        NOT NULL CHECK (platform IN ('android','ios','macos','desktop','web')),
    device_name   TEXT,
    mode          TEXT        NOT NULL DEFAULT 'live',
    is_active     BOOLEAN     NOT NULL DEFAULT false,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    revoked_by    TEXT        CHECK (revoked_by IN ('transfer','user','admin'))
);

-- Fast lookup: all active devices for an email
CREATE INDEX IF NOT EXISTS idx_regdev_email_mode
    ON registered_devices (lower(email), mode)
    WHERE is_active = true;

-- Token lookup (already unique, but explicit index for covering queries)
CREATE INDEX IF NOT EXISTS idx_regdev_token
    ON registered_devices (device_token)
    WHERE is_active = true;

-- RLS: devices are private to service_role + authenticated owner
ALTER TABLE registered_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
    ON registered_devices FOR ALL TO service_role USING (true);

-- Anon can read own rows (via SECURITY DEFINER RPCs only — not direct)
