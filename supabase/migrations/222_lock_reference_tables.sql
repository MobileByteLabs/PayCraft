-- 222 — close the tables the public key could write.
--
-- An audit of every public table (2026-11-27) found three reference tables created without RLS and with the
-- default grants, so the anon key — which every app and site ships — could INSERT / UPDATE / DELETE them:
--   tier_definitions          PayCraft's own plan limits and prices
--   pricing_bands             regional pricing bands
--   provider_method_registry  which payment methods each provider offers (checkout routing reads it)
-- Every reader (dashboard, /config, billing) only SELECTs them; only migrations and the service role write. So:
-- RLS on, everyone may read, nobody but the service role (which bypasses RLS) may write.
--
-- And ticket_votes' "Users can delete own votes" policy was `USING (true)` — anyone could delete every vote
-- straight through the REST API. Votes are removed by toggle_vote(), which is SECURITY DEFINER and never needed
-- the policy, so it is dropped.
--
-- Idempotent: ENABLE RLS is a no-op when on, policies are dropped before they are created, REVOKE is repeatable.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tier_definitions', 'pricing_bands', 'provider_method_registry'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_read', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ticket_votes belongs to the tickets layer, created on the shared project outside these migrations — a fresh
-- local stack has no such table, and DROP POLICY IF EXISTS still errors on a missing table.
DO $$
BEGIN
  IF to_regclass('public.ticket_votes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can delete own votes" ON public.ticket_votes;
  END IF;
END $$;
