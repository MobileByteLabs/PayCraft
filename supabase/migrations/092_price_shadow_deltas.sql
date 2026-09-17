-- 092_price_shadow_deltas.sql — D11 Stage A divergence log + the Stage B cut-over gate.
--
-- (The sub-plan reserved 091 for this table; 091 was taken by the anon-RPC security revoke that
--  came out of sub-plan 02's audit, so this lands at 092.)
--
-- WHY THIS IS AGGREGATED RATHER THAN ONE ROW PER REQUEST
-- The plan specified an append-only log written on every divergent /config call. /config is the
-- SDK's cold-start request for every install, so on a live tenant that is a row per app launch —
-- millions of near-identical rows, a table that costs money to keep, and an operator who cannot
-- actually read the thing the Stage B decision depends on. What the decision needs is the SET of
-- distinct divergences and how often each occurs, so the row is keyed on the divergence shape and
-- carries an occurrence count. Same evidence, bounded cardinality, and legible without a GROUP BY.
--
-- Idempotent per PayCraft migration policy.

CREATE TABLE IF NOT EXISTS paycraft_price_shadow_deltas (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  platform          text NOT NULL CHECK (platform IN ('android','ios','web','desktop','unknown')),
  served_country    text NOT NULL,
  served_provenance text NOT NULL,
  shadow_country    text NOT NULL,
  shadow_provenance text NOT NULL,
  occurrences       bigint NOT NULL DEFAULT 1,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  -- AC-18 gate. Stage B is INADMISSIBLE until an operator has recorded a read of the divergence.
  -- Nullable by design: NULL means "nobody has looked at this yet", which is exactly the state
  -- that must block a cut-over.
  read_at           timestamptz NULL,
  read_by           text NULL,
  CONSTRAINT uq_shadow_delta_shape UNIQUE
    (tenant_id, platform, served_country, served_provenance, shadow_country, shadow_provenance)
);

CREATE INDEX IF NOT EXISTS idx_shadow_delta_tenant_seen
  ON paycraft_price_shadow_deltas (tenant_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_delta_unread
  ON paycraft_price_shadow_deltas (tenant_id) WHERE read_at IS NULL;

ALTER TABLE paycraft_price_shadow_deltas ENABLE ROW LEVEL SECURITY;

-- Service role writes (the edge function); tenant admins read their own. No anon grant anywhere —
-- see migration 091 for why a default PUBLIC grant is not something to leave to chance.
DROP POLICY IF EXISTS shadow_deltas_service_all ON paycraft_price_shadow_deltas;
CREATE POLICY shadow_deltas_service_all ON paycraft_price_shadow_deltas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shadow_deltas_admin_read ON paycraft_price_shadow_deltas;
CREATE POLICY shadow_deltas_admin_read ON paycraft_price_shadow_deltas
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM tenant_admins ta
             WHERE ta.tenant_id = paycraft_price_shadow_deltas.tenant_id AND ta.user_id = auth.uid())
  );

-- Recording a divergence. SECURITY DEFINER so the edge function writes without broad table grants;
-- the ON CONFLICT collapses repeat sightings into a count instead of a new row.
CREATE OR REPLACE FUNCTION public.paycraft_shadow_delta_record(
  p_tenant_id uuid, p_platform text,
  p_served_country text, p_served_provenance text,
  p_shadow_country text, p_shadow_provenance text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO paycraft_price_shadow_deltas
    (tenant_id, platform, served_country, served_provenance, shadow_country, shadow_provenance)
  VALUES (p_tenant_id, p_platform, p_served_country, p_served_provenance,
          p_shadow_country, p_shadow_provenance)
  ON CONFLICT ON CONSTRAINT uq_shadow_delta_shape DO UPDATE
    SET occurrences  = paycraft_price_shadow_deltas.occurrences + 1,
        last_seen_at = now();
$$;
REVOKE EXECUTE ON FUNCTION public.paycraft_shadow_delta_record(uuid,text,text,text,text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.paycraft_shadow_delta_record(uuid,text,text,text,text,text) TO service_role;

-- Stage B admissibility, asked as a question rather than reimplemented at each call site.
-- Fails CLOSED: no rows read → not admissible.
CREATE OR REPLACE FUNCTION public.paycraft_shadow_read_recorded(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM paycraft_price_shadow_deltas
     WHERE tenant_id = p_tenant_id AND read_at IS NOT NULL
  );
$$;
REVOKE EXECUTE ON FUNCTION public.paycraft_shadow_read_recorded(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.paycraft_shadow_read_recorded(uuid) TO service_role, authenticated;
