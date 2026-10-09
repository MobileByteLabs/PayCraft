-- 151_interval_weekly_cadence.sql
--
-- Add `week` to the product interval vocabulary.
--
-- WHY
-- The default catalogue every consumer gets becomes week / month / quarter / year. `week` is
-- currently REJECTED by tenant_products_interval_check, so no seed, dashboard form or provider sync
-- can store it. This is the one change that must land before any of the rest.
--
-- WIDEN, NEVER REBUILD FROM AN OLDER MIGRATION'S LIST
-- The new value set is the UNION of what the LIVE constraint allows plus `week`, read from
-- pg_get_constraintdef at authoring time:
--
--   CHECK ((interval IS NULL) OR (interval = ANY (ARRAY['month','quarter','semiannual','year'])))
--
-- `semiannual` STAYS. It is not in the new default catalogue, but dropping a default tier is not the
-- same as revoking a value: 4 live rows use `semiannual` right now, and a constraint that no longer
-- admits them would fail this migration (SQLSTATE 23514) or, worse, apply cleanly on an environment
-- that happens to hold none and silently revoke the ability to store it. That is exactly the
-- incident migration 150 caused and `framework-verify-migration-no-narrowing.sh`
-- (G-MIGRATION-NO-NARROWING) now refuses. Retiring a tier is a CATALOGUE decision, enforced at the
-- seed; the column stays permissive.
--
-- COMPANION CHANGE, IN THE SAME MIGRATION ON PURPOSE
-- Migration 088's backfill maps interval -> a reserved package role and RAISEs on an unmapped value.
-- Its own comment predicted this change:
--
--   "$rc_two_month and $rc_weekly stay in the reserved-role CHECK on tenant_packages but have no arm
--    here: there is no interval value that maps to them today. They are reserved for a future
--    cadence"
--
-- `$rc_weekly` is therefore ALREADY in tenant_packages_role_reserved — no CHECK change is needed
-- there. What is needed is the mapping arm, so a weekly product lands in $rc_weekly instead of
-- hitting the ELSE and aborting. Shipping the widened CHECK without it would make the very first
-- weekly product raise "unmappable product" on the next backfill.

-- ── 1. Widen the interval vocabulary ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_products'::regclass
      AND conname  = 'tenant_products_interval_check'
  ) THEN
    ALTER TABLE public.tenant_products DROP CONSTRAINT tenant_products_interval_check;
  END IF;
END $$;

ALTER TABLE public.tenant_products
  ADD CONSTRAINT tenant_products_interval_check
  CHECK (
    "interval" IS NULL
    OR "interval" = ANY (ARRAY['week'::text, 'month'::text, 'quarter'::text, 'semiannual'::text, 'year'::text])
  );

COMMENT ON COLUMN public.tenant_products."interval" IS
  'Billing cadence: week | month | quarter | semiannual | year, or NULL for a non-recurring product. '
  'NOT ISO-8601. The DEFAULT CATALOGUE seeds week/month/quarter/year; semiannual remains storable for '
  'tenants that already sell it. Widening this list requires a matching arm in the interval -> '
  'package-role mapping (see tenant_products_package_role below) or the backfill will RAISE.';

-- ── 2. Teach the interval -> package-role mapping about `week` ──────────────
-- Extracted as a FUNCTION rather than left inline in 088's DO block, so there is ONE definition the
-- next cadence has to edit instead of a copy per migration. 088's inline CASE stays as-is: it
-- already ran, and rewriting an applied migration is forbidden.
CREATE OR REPLACE FUNCTION public.tenant_products_package_role(
  p_type     text,
  p_interval text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type = 'lifetime'       THEN '$rc_lifetime'
    WHEN p_interval = 'year'       THEN '$rc_annual'
    WHEN p_interval = 'semiannual' THEN '$rc_six_month'
    WHEN p_interval = 'quarter'    THEN '$rc_three_month'
    WHEN p_interval = 'month'      THEN '$rc_monthly'
    WHEN p_interval = 'week'       THEN '$rc_weekly'
    WHEN p_interval IS NULL        THEN '$rc_custom'
    ELSE NULL                      -- forward-compat guard: a new cadence stops here, loudly
  END;
$$;

COMMENT ON FUNCTION public.tenant_products_package_role(text, text) IS
  'Maps (product type, interval) to a reserved tenant_packages role. Returns NULL for an unmapped '
  'cadence so callers RAISE rather than silently orphan a product — the forward-compatibility guard '
  'migration 088 documented. Adding an interval value means adding an arm HERE.';

-- ── 3. Backfill any product the widened vocabulary now makes mappable ───────
-- A no-op today (no weekly product can exist yet, because the CHECK forbade it until a moment ago).
-- Present so the migration is correct if replayed against a database where one was inserted between
-- the ALTER above and this statement.
DO $backfill$
DECLARE p RECORD; v_role text; off_id uuid; pkg_id uuid;
BEGIN
  FOR p IN
    SELECT tp.id, tp.tenant_id, tp.type, tp."interval"
    FROM tenant_products tp
    WHERE tp.package_id IS NULL AND tp."interval" = 'week'
  LOOP
    v_role := tenant_products_package_role(p.type, p."interval");
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'unmappable weekly product tenant=% id=% — refuses silent drop', p.tenant_id, p.id;
    END IF;
    SELECT id INTO off_id FROM tenant_offerings
      WHERE tenant_id = p.tenant_id AND identifier = 'default';
    IF off_id IS NULL THEN
      INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current)
      VALUES (p.tenant_id, 'default', 'Default', true)
      RETURNING id INTO off_id;
    END IF;
    INSERT INTO tenant_packages (offering_id, tenant_id, role_identifier, display_name)
    VALUES (off_id, p.tenant_id, v_role, v_role)
    ON CONFLICT (offering_id, role_identifier) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id INTO pkg_id;
    UPDATE tenant_products SET package_id = pkg_id WHERE id = p.id;
  END LOOP;
END $backfill$;
