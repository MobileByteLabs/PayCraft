-- 158 — tenant_products_upsert must accept grant_quantity, and enforce the consumable rule.
--
-- 157 added the COLUMN but not the write path. tenant_products_upsert carries an explicit column
-- list, so a dashboard sending grant_quantity had it SILENTLY DROPPED — the product saves, reports
-- success, and credits nothing when bought. That is strictly worse than rejecting it: the operator
-- believes the pack grants 500 coins and only a customer discovers it does not.
--
-- The READ path needed no change and deliberately gets none: tenant_products_list is
-- `SELECT * ... RETURNS SETOF tenant_products`, and the /config edge function spreads the row, so
-- grant_quantity and `type: 'consumable'` already reach the SDK.
--
-- ## Why the rule lives here rather than in a CHECK
--
-- 157 could not add `CHECK (type = 'consumable') = (grant_quantity IS NOT NULL)` because a CHECK
-- referencing an enum value added in the SAME migration fails on some PG versions ("unsafe use of
-- new value of enum type"). By 158 the value is committed, so a CHECK is now possible — but the
-- upsert is still the better home, because it can REJECT WITH A REASON the operator can act on
-- ("grant_quantity is required for a consumable") where a constraint violation names only the
-- constraint. The table CHECK is added too, as the backstop for any writer that bypasses the RPC.

-- ── 1. the rule as a constraint (backstop) ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_grant_quantity_consumable_only'
  ) THEN
    ALTER TABLE public.tenant_products
      ADD CONSTRAINT tenant_products_grant_quantity_consumable_only
      CHECK (
        (type = 'consumable' AND grant_quantity IS NOT NULL)
        OR (type <> 'consumable' AND grant_quantity IS NULL)
      );
  END IF;
END $$;

-- ── 2. the write path ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_type  product_type;
  v_grant INT;
BEGIN
  v_type  := (p_row->>'type')::product_type;
  v_grant := NULLIF(p_row->>'grant_quantity','')::INT;

  -- Reject, never ignore. A dropped grant ships a product that sells and credits nothing, and the
  -- operator has no way to tell from the dashboard that it happened.
  IF v_type = 'consumable' AND (v_grant IS NULL OR v_grant < 1) THEN
    RAISE EXCEPTION 'grant_quantity is required for a consumable product and must be >= 1'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_type <> 'consumable' AND v_grant IS NOT NULL THEN
    RAISE EXCEPTION 'grant_quantity is only valid for a consumable product (got type=%)', v_type
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    grant_quantity
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    v_type,
    p_row->>'display_name',
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true),
    v_grant
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        grant_quantity         = EXCLUDED.grant_quantity,
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
