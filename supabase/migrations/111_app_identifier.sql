-- 111_app_identifier.sql
--
-- One app identifier, held by the APP, instead of two per-provider copies that can disagree.
--
-- `com.acme.app` is the Android package name and the iOS bundle id, and for these apps they are the
-- same string — but it was stored twice: `package_name` inside the google_play row's `store_config`
-- and `bundle_id` inside the app_store row's. Two copies of one fact, written through two forms, is
-- a drift waiting to happen — and the drift is silent and expensive, because the identifier is what
-- addresses the store when syncing a product or validating a purchase. An app whose iOS copy was
-- edited and Android copy was not looks completely healthy right up to the point that one platform
-- starts writing to the wrong listing.
--
-- Worse, the copies were also credential-scoped in practice: change which Play console an app bills
-- through and the package name travelled with the app row, but nothing checked the two halves still
-- described the same application.
--
-- So the identifier moves to `tenants.app_identifier` — the app owns it, both providers read it —
-- and the per-provider copies become a derived, backfilled remnant that continues to be written for
-- older readers.
--
-- Deliberately NOT unique. The same identifier legitimately appears more than once: a test app and
-- a live app, or a staging tenant mirroring production, and rejecting that would block a setup
-- people already have. Its job is to be ONE value per app, not a global key.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS app_identifier TEXT;

COMMENT ON COLUMN public.tenants.app_identifier IS
  'The application id — Android package name AND iOS bundle id, which are the same string. Single source of truth; tenant_providers.store_config copies are derived.';

-- ── Backfill from whichever provider row already carries it ──────────────────────────────────
-- Android first only because it is the more commonly configured of the two here; where both exist
-- and agree it makes no difference, and where they DISAGREE the mismatch is surfaced below rather
-- than silently resolved, because picking a winner would be inventing an answer.
UPDATE public.tenants t
SET app_identifier = COALESCE(
      (SELECT tp.store_config->>'package_name' FROM tenant_providers tp
        WHERE tp.tenant_id = t.id AND tp.provider = 'google_play'
          AND NULLIF(btrim(tp.store_config->>'package_name'),'') IS NOT NULL),
      (SELECT tp.store_config->>'bundle_id' FROM tenant_providers tp
        WHERE tp.tenant_id = t.id AND tp.provider = 'app_store'
          AND NULLIF(btrim(tp.store_config->>'bundle_id'),'') IS NOT NULL)
    )
WHERE t.app_identifier IS NULL;

-- ── Report any app whose two copies already disagree ─────────────────────────────────────────
-- A NOTICE, not an exception: this migration must not refuse to apply because of pre-existing data,
-- but a disagreement is exactly the drift the column exists to end and it should not pass unseen.
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.name,
           gp.store_config->>'package_name' AS pkg,
           ap.store_config->>'bundle_id'    AS bid
    FROM tenants t
    JOIN tenant_providers gp ON gp.tenant_id = t.id AND gp.provider = 'google_play'
    JOIN tenant_providers ap ON ap.tenant_id = t.id AND ap.provider = 'app_store'
    WHERE NULLIF(btrim(gp.store_config->>'package_name'),'') IS NOT NULL
      AND NULLIF(btrim(ap.store_config->>'bundle_id'),'')    IS NOT NULL
      AND btrim(gp.store_config->>'package_name') <> btrim(ap.store_config->>'bundle_id')
  LOOP
    RAISE NOTICE 'app_identifier mismatch: tenant % (%) package_name=% bundle_id=%', r.id, r.name, r.pkg, r.bid;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'app_identifier: % tenant(s) with disagreeing package_name/bundle_id', n;
END;
$$;

-- ── Save + read the identifier in one place ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_app_identifier_set(
  p_tenant_id UUID,
  p_identifier TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_id := NULLIF(btrim(p_identifier), '');
  IF v_id IS NULL THEN RAISE EXCEPTION 'app_identifier_required'; END IF;

  UPDATE tenants SET app_identifier = v_id, updated_at = now() WHERE id = p_tenant_id;

  -- Keep the per-provider copies in step. They are no longer the source of truth, but
  -- `sync-to-providers`, the onboarding importer and the Edge Functions still read them, and a
  -- migration that moved the truth without updating the readers would simply relocate the drift.
  UPDATE tenant_providers
     SET store_config = COALESCE(store_config,'{}'::jsonb) || jsonb_build_object('package_name', v_id)
   WHERE tenant_id = p_tenant_id AND provider = 'google_play';
  UPDATE tenant_providers
     SET store_config = COALESCE(store_config,'{}'::jsonb) || jsonb_build_object('bundle_id', v_id)
   WHERE tenant_id = p_tenant_id AND provider = 'app_store';

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.tenant_app_identifier_set(UUID, TEXT) IS
  'Sets the app identifier (package name == bundle id) and mirrors it onto both provider rows for readers that still consult store_config.';

REVOKE ALL ON FUNCTION public.tenant_app_identifier_set(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_app_identifier_set(UUID, TEXT) TO authenticated, service_role;
