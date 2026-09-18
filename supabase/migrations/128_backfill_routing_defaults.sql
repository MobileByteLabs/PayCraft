-- 128_backfill_routing_defaults.sql
--
-- Apply the routing defaults to tenants that already existed.
--
-- Migration 126 wired `tenant_routing_apply_defaults` into `provision_app`, so every app created
-- from then on gets a primary and a fallback per platform. Apps created BEFORE it were untouched —
-- six of eight local tenants had no platform routing row at all, and two more were missing `web` and
-- `desktop`. Leaving them that way means the fix applies to whoever signs up next while every
-- existing customer keeps the defect, which is the least defensible half of a rollout.
--
-- Insert-only, via the same function provisioning uses. A platform that already has a rule is left
-- exactly as its operator set it — Hacker Keyboard's deliberate `desktop -> razorpay` and
-- `web -> razorpay` survive this migration unchanged. The only rows written are for platforms whose
-- current behaviour is "no rule at all", so nothing an operator decided can be overwritten.
--
-- Runs as the migration role, which is why it calls the unchecked worker rather than the (now
-- removed) membership-checked wrapper: there is no `auth.uid()` during a migration.

DO $$
DECLARE
  t record;
  seeded int := 0;
  rows_added int;
BEGIN
  FOR t IN SELECT id, name FROM tenants LOOP
    SELECT count(*) INTO rows_added
    FROM tenant_routing_apply_defaults(t.id)
    WHERE created;

    IF rows_added > 0 THEN
      seeded := seeded + 1;
      RAISE NOTICE 'routing defaults: seeded % platform(s) for tenant % (%)', rows_added, t.name, t.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'routing defaults backfill complete: % tenant(s) updated', seeded;
END $$;
