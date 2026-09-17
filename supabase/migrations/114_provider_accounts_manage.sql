-- 114_provider_accounts_manage.sql
--
-- Manage connections where they actually live: on the ACCOUNT, across every provider at once.
--
-- `provider_accounts_list(p_provider)` answers "which Play consoles do I have?" — a per-provider,
-- per-app question, asked from inside one app's settings. But a connection is not owned by an app or
-- by a provider page; it is owned by the operator, and the questions that matter about it are
-- account-wide: what have I connected, which is the default for each provider, how many apps depend
-- on this key, and is this one still used by anything. None of those can be answered from a page
-- scoped to one app and one provider.
--
-- Three functions, and the shape of each is decided by the thing it protects:
--
--   • `provider_accounts_list_all` — every connection the caller can see, with `apps_using`.
--     That count is the whole point of the page: it is what turns "rotate this key" from a guess
--     into an informed decision, and it is what makes a delete refusal comprehensible.
--
--   • `provider_accounts_rename` — labels are how an operator tells two Play consoles apart, and a
--     backfilled label like "google_play connection" tells them nothing. Renaming touches no
--     credential and no attachment, so it is the one operation here that is always safe.
--
--   • `provider_accounts_delete` — REFUSES while any app still points at the connection. The
--     alternative designs are worse: cascading the delete silently unpins those apps (they fall to
--     the default and start billing through a different account — the exact class 113 just fixed),
--     and nulling the pointer is the same thing wearing a different name. The operator must move
--     the apps first, which is a decision only they can make, and the error names the count so they
--     know how much work that is.

-- ── 1. Every connection, across providers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_list_all()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'provider', x->>'label'), '[]'::jsonb) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id',             a.id,
      'provider',       a.provider,
      'label',          a.label,
      'is_default',     a.is_default,
      -- Never the credential itself, only whether one is present. A management page has no reason
      -- to hold a key, and a value that never leaves the database cannot leak from the browser.
      'has_credential', a.credential_enc IS NOT NULL,
      'config',         COALESCE(a.config, '{}'::jsonb),
      'apps_using',     (SELECT count(*) FROM tenant_providers tp WHERE tp.provider_account_id = a.id),
      'is_mine',        a.owner_user_id = auth.uid(),
      'created_at',     a.created_at
    ) AS x
    FROM provider_accounts a
    WHERE a.owner_user_id = auth.uid()
       -- Connections owned by a co-admin of an app you administer: you can SEE them, because your
       -- app may be billing through one and a page that hid it would be lying about what is
       -- connected. Mutating them is refused below.
       OR a.owner_user_id IN (
            SELECT ta2.user_id FROM tenant_admins ta1
            JOIN tenant_admins ta2 ON ta2.tenant_id = ta1.tenant_id
            WHERE ta1.user_id = auth.uid()
          )
  ) s;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.provider_accounts_list_all() IS
  'Every provider connection visible to the caller, across providers, with apps_using. Never returns a credential.';

-- ── 2. Rename ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_rename(p_id UUID, p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_label TEXT;
BEGIN
  v_label := NULLIF(btrim(p_label), '');
  IF v_label IS NULL THEN RAISE EXCEPTION 'label_required'; END IF;

  UPDATE provider_accounts
     SET label = v_label, updated_at = now()
   WHERE id = p_id AND owner_user_id = auth.uid();

  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden_connection'; END IF;
  RETURN v_label;
END;
$$;

COMMENT ON FUNCTION public.provider_accounts_rename(UUID, TEXT) IS
  'Renames a connection the caller OWNS. Touches no credential and no attachment.';

-- ── 3. Delete, refused while in use ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_delete(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_in_use INT; v_acct RECORD;
BEGIN
  SELECT * INTO v_acct FROM provider_accounts WHERE id = p_id AND owner_user_id = auth.uid();
  IF v_acct.id IS NULL THEN RAISE EXCEPTION 'forbidden_connection'; END IF;

  SELECT count(*) INTO v_in_use FROM tenant_providers WHERE provider_account_id = p_id;
  IF v_in_use > 0 THEN
    -- Deleting would unpin these apps, and an unpinned app falls to the account default — so a
    -- delete would quietly move live billing to a different provider account. Refuse, and say how
    -- many apps have to be moved first.
    RAISE EXCEPTION 'connection_in_use:%', v_in_use;
  END IF;

  DELETE FROM provider_accounts WHERE id = p_id;

  -- Deleting the default leaves the provider with none, and every app that was inheriting it would
  -- silently become unconnected. Promote the oldest remaining connection so inheritance keeps
  -- working; with none left there is nothing to promote and nothing inheriting.
  IF v_acct.is_default THEN
    UPDATE provider_accounts SET is_default = true, updated_at = now()
    WHERE id = (
      SELECT id FROM provider_accounts
      WHERE owner_user_id = auth.uid() AND provider = v_acct.provider
      ORDER BY created_at LIMIT 1
    );
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.provider_accounts_delete(UUID) IS
  'Deletes a connection the caller OWNS, refusing while any app points at it. Promotes the oldest remaining connection when the default is removed.';

REVOKE ALL ON FUNCTION public.provider_accounts_list_all()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_accounts_rename(UUID, TEXT)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_accounts_delete(UUID)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_accounts_list_all()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_accounts_rename(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_accounts_delete(UUID)       TO authenticated, service_role;
