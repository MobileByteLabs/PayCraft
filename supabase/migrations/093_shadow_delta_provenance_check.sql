-- 093_shadow_delta_provenance_check.sql — constrain the provenance columns.
--
-- 092 put a CHECK on `platform` but none on the two provenance columns, and the edge function cast
-- a client-supplied `X-PayCraft-Country-Provenance` header past the type system with `as never`.
-- Arbitrary text therefore reached the table an operator reads before authorising the Stage B
-- price cut-over — an audit trail any caller could shape.
--
-- The edge function now whitelists the header. This is the second half: defence at the column, so
-- the guarantee does not depend on one caller remembering to validate. Belt and braces is right
-- here because the cost of a bad row is a release decision made on false evidence.
--
-- Idempotent per PayCraft migration policy: constraint creation is guarded on pg_constraint.

-- Any pre-existing out-of-vocabulary rows are normalised rather than blocking the migration; they
-- came from the unvalidated path and carry no trustworthy meaning.
UPDATE paycraft_price_shadow_deltas
   SET served_provenance = 'default'
 WHERE served_provenance NOT IN ('override','storefront','server_geo','device','locale','default');
UPDATE paycraft_price_shadow_deltas
   SET shadow_provenance = 'default'
 WHERE shadow_provenance NOT IN ('override','storefront','server_geo','device','locale','default');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shadow_delta_served_provenance_valid'
  ) THEN
    ALTER TABLE paycraft_price_shadow_deltas
      ADD CONSTRAINT shadow_delta_served_provenance_valid
      CHECK (served_provenance IN ('override','storefront','server_geo','device','locale','default'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shadow_delta_shadow_provenance_valid'
  ) THEN
    ALTER TABLE paycraft_price_shadow_deltas
      ADD CONSTRAINT shadow_delta_shadow_provenance_valid
      CHECK (shadow_provenance IN ('override','storefront','server_geo','device','locale','default'));
  END IF;
END $$;
