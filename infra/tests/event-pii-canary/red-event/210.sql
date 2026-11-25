CREATE TABLE IF NOT EXISTS public.attempt_events (
  id            BIGSERIAL   PRIMARY KEY,
  attempt_id    TEXT        NOT NULL,
  tenant_id     UUID        NOT NULL,
  stage         TEXT        NOT NULL,
  event         TEXT        NOT NULL,
  error_class   TEXT,
  error_code    TEXT,
  error_message TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS attempt_id TEXT;
