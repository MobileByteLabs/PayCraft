CREATE TABLE IF NOT EXISTS public.paywall_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  user_ref    TEXT,
  device_ref  TEXT,
  name        TEXT NOT NULL,
  step        TEXT NOT NULL,
  platform    TEXT NOT NULL,
  sku         TEXT,
  reason      TEXT,
  country     TEXT,
  mode        TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);
