-- Migration 056 — Allow tenant admins to SELECT their own tenant_providers rows.
--
-- Before this, the only policy on tenant_providers was `service_role` —
-- meaning the dashboard's user-context Supabase client could NOT read the
-- list of configured providers for the active tenant. The /providers list
-- page silently rendered "Not connected" badges even when manual API keys
-- had been saved (the row exists, but RLS blocked the read).
--
-- The encrypted-secret columns are bytea — exposing them via SELECT is safe
-- because only the SECURITY DEFINER `decrypt_provider_key()` function can
-- turn them back into plaintext, and that function checks for service_role
-- elevation. tenant_admins can see "yes there's a row" + the publishable
-- key_id (which is non-secret by design) without seeing the actual secret.

DROP POLICY IF EXISTS "tenant_providers_admin_select" ON public.tenant_providers;

CREATE POLICY "tenant_providers_admin_select"
  ON public.tenant_providers FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_admins WHERE user_id = auth.uid()
    )
  );
