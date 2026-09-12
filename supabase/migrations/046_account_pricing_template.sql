-- Migration 046: Account-level pricing template — per-user USD reference + per-country overrides.
-- Pairs with Phase 3 of paycraft-dashboard-provider-integration epic.

CREATE TABLE IF NOT EXISTS public.account_pricing_template (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  usd_reference_cents  INTEGER NOT NULL DEFAULT 999,
  overrides            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "IN": {"amountCents": 29900}, "JP": {"amountCents": 110000}, ... }
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_pricing_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_pricing_template_own
  ON public.account_pricing_template
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RPC: get own template (returns NULL if not yet customized — caller uses defaults).
CREATE OR REPLACE FUNCTION account_pricing_template_get()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT to_jsonb(t.*)
    FROM account_pricing_template t
    WHERE t.user_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION account_pricing_template_get() TO authenticated;

-- RPC: upsert own template.
CREATE OR REPLACE FUNCTION account_pricing_template_save(
  p_usd_reference_cents INTEGER,
  p_overrides           JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_pricing_template (user_id, usd_reference_cents, overrides, updated_at)
  VALUES (auth.uid(), p_usd_reference_cents, p_overrides, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    usd_reference_cents = EXCLUDED.usd_reference_cents,
    overrides           = EXCLUDED.overrides,
    updated_at          = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION account_pricing_template_save(integer, jsonb) TO authenticated;
