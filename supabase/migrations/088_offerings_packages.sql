-- 088_offerings_packages.sql — Offering → Package → Product model (D2).
--
-- WHY THIS SHAPE
-- A paywall that names SKUs directly cannot survive a SKU change: swapping the underlying product
-- means editing every paywall that referenced it. Binding the paywall to a package ROLE instead
-- ($rc_monthly) makes the SKU an implementation detail the merchant can swap without touching a
-- paywall. That indirection is the whole point of the Offering → Package → Product model, and
-- Epic 2's server-driven component tree binds to these role identifiers.
--
-- Idempotent per PayCraft migration policy (CLAUDE.md): CREATE TABLE/INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, constraint creation guarded — survives `supabase db reset` and a
-- partial re-apply.

CREATE TABLE IF NOT EXISTS tenant_offerings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identifier   text NOT NULL,                              -- 'default' or merchant-authored
  display_name text NOT NULL,
  is_current   boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  metadata     jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_offering_ident UNIQUE (tenant_id, identifier)
);

CREATE TABLE IF NOT EXISTS tenant_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id     uuid NOT NULL REFERENCES tenant_offerings(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  role_identifier text NOT NULL,
  display_name    text NOT NULL,
  display_order   int  NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_offering_role UNIQUE (offering_id, role_identifier),
  -- Reserved role identifiers. $rc_custom admits a merchant slot so the schema does not
  -- foreclose Epic 2's non-subscription products.
  CONSTRAINT tenant_packages_role_reserved CHECK (
    role_identifier IN ('$rc_lifetime','$rc_annual','$rc_six_month',
                        '$rc_three_month','$rc_two_month','$rc_monthly',
                        '$rc_weekly','$rc_custom')
  )
);

CREATE INDEX IF NOT EXISTS idx_tenant_offerings_tenant ON tenant_offerings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_packages_offering ON tenant_packages(offering_id);

ALTER TABLE tenant_products ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES tenant_packages(id);
CREATE INDEX IF NOT EXISTS idx_tenant_products_package ON tenant_products(package_id);

ALTER TABLE tenant_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_packages  ENABLE ROW LEVEL SECURITY;

-- Service role owns writes; tenant admins read their own. Mirrors the tenant_products policy shape.
DROP POLICY IF EXISTS tenant_offerings_service_all ON tenant_offerings;
CREATE POLICY tenant_offerings_service_all ON tenant_offerings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tenant_packages_service_all ON tenant_packages;
CREATE POLICY tenant_packages_service_all ON tenant_packages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tenant_offerings_admin_read ON tenant_offerings;
CREATE POLICY tenant_offerings_admin_read ON tenant_offerings
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM tenant_admins ta
             WHERE ta.tenant_id = tenant_offerings.tenant_id AND ta.user_id = auth.uid())
  );
DROP POLICY IF EXISTS tenant_packages_admin_read ON tenant_packages;
CREATE POLICY tenant_packages_admin_read ON tenant_packages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM tenant_admins ta
             WHERE ta.tenant_id = tenant_packages.tenant_id AND ta.user_id = auth.uid())
  );

-- ── Backfill: default offering per tenant, one package per role ──────────────
-- REFUSES TO SILENTLY DROP. A product whose shape cannot be classified aborts the whole
-- migration naming the offending row, rather than being left with a null package_id where a
-- later "clean up the nulls" pass would quietly delete it. A backfill that loses a merchant's
-- product is worse than a backfill that fails loudly.
--
-- Given the CHECK constraint on tenant_products.interval, the ELSE arm is currently unreachable:
-- every storable value has a mapping. It is a FORWARD-COMPATIBILITY guard, and that is precisely
-- its value — the day someone widens the interval CHECK to add a cadence and forgets this CASE,
-- the backfill stops instead of silently leaving those products unmapped. The AC-7 RED canary
-- simulates exactly that by widening the constraint before re-running.
DO $backfill$
DECLARE
  t_id uuid; off_id uuid; pkg_id uuid; p RECORD; v_role text; unmapped int;
BEGIN
  FOR t_id IN SELECT DISTINCT tenant_id FROM tenant_products WHERE package_id IS NULL LOOP
    INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current)
    VALUES (t_id, 'default', 'Default', true)
    ON CONFLICT (tenant_id, identifier) DO UPDATE SET updated_at = now()
    RETURNING id INTO off_id;

    FOR p IN SELECT id, type, interval FROM tenant_products
              WHERE tenant_id = t_id AND package_id IS NULL LOOP
      -- Interval vocabulary is NOT ISO-8601. tenant_products_interval_check constrains this
      -- column to exactly {month, quarter, semiannual, year} or NULL, so mapping 'P1M'/'P1Y'
      -- here would match nothing that can physically be stored and would RAISE on every real
      -- subscription. The arms below mirror the CHECK constraint verbatim.
      --
      -- $rc_two_month and $rc_weekly stay in the reserved-role CHECK on tenant_packages but have
      -- no arm here: there is no interval value that maps to them today. They are reserved for a
      -- future cadence, not dead aliases for one that exists.
      --
      -- A non-lifetime product with a NULL interval is a legitimate non-recurring product, not an
      -- error — it maps to the merchant-custom slot rather than aborting the migration.
      --
      -- TRIAL products (product_type has three values: subscription, trial, lifetime) intentionally
      -- have no arm of their own: a trial maps by its CADENCE, so a trial-of-monthly joins the
      -- $rc_monthly package. That is deliberate, because a trial is a flavour of the plan it
      -- converts into, not a separate commercial slot — RevenueCat models it the same way, via a
      -- package's introductory offer. If a dedicated $rc_trial role is ever wanted, it needs both
      -- an arm here AND an addition to the reserved-role CHECK above; a trial with a NULL interval
      -- currently lands in $rc_custom.
      v_role := CASE
        WHEN p.type = 'lifetime'        THEN '$rc_lifetime'
        WHEN p.interval = 'year'        THEN '$rc_annual'
        WHEN p.interval = 'semiannual'  THEN '$rc_six_month'
        WHEN p.interval = 'quarter'     THEN '$rc_three_month'
        WHEN p.interval = 'month'       THEN '$rc_monthly'
        WHEN p.interval IS NULL         THEN '$rc_custom'
        ELSE NULL
      END;
      IF v_role IS NULL THEN
        RAISE EXCEPTION
          'unmappable product tenant=% id=% type=% interval=% — refuses silent drop',
          t_id, p.id, p.type, p.interval;
      END IF;
      INSERT INTO tenant_packages (offering_id, tenant_id, role_identifier, display_name)
      VALUES (off_id, t_id, v_role, v_role)
      ON CONFLICT (offering_id, role_identifier) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id INTO pkg_id;
      UPDATE tenant_products SET package_id = pkg_id WHERE id = p.id;
    END LOOP;
  END LOOP;

  -- Post-loop invariant: nothing may be left behind.
  SELECT count(*) INTO unmapped FROM tenant_products WHERE package_id IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'backfill left % products unmapped', unmapped;
  END IF;
END
$backfill$;
