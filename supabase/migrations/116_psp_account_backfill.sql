-- 116_psp_account_backfill.sql
--
-- Lift existing PSP credentials onto the ACCOUNT tier, the way 103 did for stores.
--
-- 112 gave PSPs everything the stores had — a credential document on `provider_accounts`, a shared
-- resolver, a save path — and then backfilled nothing. 103 moved every store credential up in the
-- same migration that created the table; 112 did not, so the tier exists and is empty: measured on
-- production, `provider_accounts` holds 6 store connections and **zero** for stripe/razorpay/cashfree.
--
-- The consequence is that "every app adopts the account default" is true for stores and vacuous for
-- PSPs. cappy is the worked example: its google_play and app_store rows are pinned to account
-- connections, while its stripe and razorpay credentials sit on its own `tenant_providers` row where
-- no other app can reach them. Six apps billing through one Stripe account still means six pasted
-- keys and six rotations.
--
-- ── What this moves, and what it deliberately does not ───────────────────────────────────────
-- MOVED: the six credential fields — {test,live} × {key_id, secret, webhook_secret} — into the
-- encrypted document shape 112 defined, one connection per (owner, provider, distinct credential).
--
-- NOT MOVED: `payment_links` and `supported_locales`. They stay on `tenant_providers` because they
-- are app-scoped — a payment link is a per-app checkout URL. Two apps sharing a Stripe account do
-- not share a checkout page.
--
-- NOT DELETED: the app-local columns are left intact. Under 113's precedence an explicit pin wins,
-- so an attached app reads the account copy; leaving the originals means a bad backfill row can be
-- undone by clearing `provider_account_id`, with nothing lost. They can be cleared later, once the
-- account tier has been running long enough to trust.
--
-- Plaintext never leaves the database: decrypt and re-encrypt happen inside one SECURITY DEFINER
-- block, using the same `paycraft_secrets_config` passphrase both sides already share.

DO $$
DECLARE
  r          RECORD;
  v_owner    UUID;
  v_doc      JSONB;
  v_cfg      JSONB;
  v_id       UUID;
  v_label    TEXT;
  n_made     INT := 0;
  n_attached INT := 0;
BEGIN
  FOR r IN
    SELECT tp.tenant_id, tp.provider, tp.test_key_id, tp.live_key_id,
           tp.test_secret_key_enc, tp.live_secret_key_enc,
           tp.test_webhook_secret_enc, tp.live_webhook_secret_enc,
           t.name AS tenant_name, t.owner_email
    FROM tenant_providers tp
    JOIN tenants t ON t.id = tp.tenant_id
    WHERE tp.provider IN ('stripe', 'razorpay', 'cashfree')
      AND tp.provider_account_id IS NULL
      AND (tp.test_secret_key_enc IS NOT NULL OR tp.live_secret_key_enc IS NOT NULL)
  LOOP
    -- The OWNER holds the credential, matching how 103 and 113 resolve "the account".
    SELECT u.id INTO v_owner
    FROM auth.users u WHERE lower(u.email) = lower(r.owner_email) LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM tenant_admins
      WHERE tenant_id = r.tenant_id ORDER BY created_at LIMIT 1;
    END IF;
    CONTINUE WHEN v_owner IS NULL;   -- no user to own it; leave the app-local copy in place

    v_doc := jsonb_strip_nulls(jsonb_build_object(
      'test_key_id',         NULLIF(r.test_key_id, ''),
      'live_key_id',         NULLIF(r.live_key_id, ''),
      'test_secret',         CASE WHEN r.test_secret_key_enc IS NOT NULL
                                  THEN decrypt_provider_key(r.test_secret_key_enc)::TEXT END,
      'live_secret',         CASE WHEN r.live_secret_key_enc IS NOT NULL
                                  THEN decrypt_provider_key(r.live_secret_key_enc)::TEXT END,
      'test_webhook_secret', CASE WHEN r.test_webhook_secret_enc IS NOT NULL
                                  THEN decrypt_provider_key(r.test_webhook_secret_enc)::TEXT END,
      'live_webhook_secret', CASE WHEN r.live_webhook_secret_enc IS NOT NULL
                                  THEN decrypt_provider_key(r.live_webhook_secret_enc)::TEXT END
    ));

    -- Non-secret ids only, so the picker can tell two connections apart without decrypting.
    v_cfg := jsonb_strip_nulls(jsonb_build_object(
      'test_key_id', NULLIF(r.test_key_id, ''),
      'live_key_id', NULLIF(r.live_key_id, '')
    ));

    -- Reuse a connection that already holds the SAME credential rather than minting one per app —
    -- that is the entire point of the tier. Identity is the live key id, else the test key id.
    SELECT a.id INTO v_id
    FROM provider_accounts a
    WHERE a.owner_user_id = v_owner
      AND a.provider = r.provider
      AND (
        (NULLIF(r.live_key_id,'') IS NOT NULL AND a.config->>'live_key_id' = r.live_key_id)
        OR (NULLIF(r.test_key_id,'') IS NOT NULL AND a.config->>'test_key_id' = r.test_key_id)
      )
    LIMIT 1;

    IF v_id IS NULL THEN
      -- A readable label, not the raw key id. Stripe's publishable key is ~107 characters, which
      -- would fill the connection picker with a string nobody can scan. Keep the prefix (it says
      -- live vs test at a glance) and the last 4 (enough to tell two accounts apart) — the same
      -- shape every payment dashboard uses.
      v_label := COALESCE(NULLIF(r.live_key_id, ''), NULLIF(r.test_key_id, ''));
      IF v_label IS NOT NULL AND length(v_label) > 18 THEN
        v_label := substring(v_label from 1 for 8) || '…' || right(v_label, 4);
      END IF;
      v_label := COALESCE(v_label, r.tenant_name || ' ' || r.provider);
      INSERT INTO provider_accounts (owner_user_id, provider, label, credential_enc, config, is_default)
      VALUES (
        v_owner, r.provider, v_label, encrypt_provider_key(v_doc::TEXT), v_cfg,
        -- First connection for this (owner, provider) becomes the default; a lone connection that
        -- is not the default leaves every following app resolving to nothing.
        NOT EXISTS (SELECT 1 FROM provider_accounts p2
                    WHERE p2.owner_user_id = v_owner AND p2.provider = r.provider)
      )
      RETURNING id INTO v_id;
      n_made := n_made + 1;
    END IF;

    UPDATE tenant_providers SET provider_account_id = v_id
    WHERE tenant_id = r.tenant_id AND provider = r.provider;
    n_attached := n_attached + 1;
  END LOOP;

  RAISE NOTICE 'psp backfill: % connection(s) created, % app-provider row(s) attached', n_made, n_attached;
END;
$$;

-- Assert the tier is no longer empty for PSPs: a backfill that silently matched nothing would leave
-- exactly the state it exists to fix, while reporting success.
DO $$
DECLARE n INT; orphans INT;
BEGIN
  SELECT count(*) INTO n FROM provider_accounts WHERE provider IN ('stripe','razorpay','cashfree');
  SELECT count(*) INTO orphans FROM tenant_providers tp
  WHERE tp.provider IN ('stripe','razorpay','cashfree')
    AND tp.provider_account_id IS NULL
    AND (tp.test_secret_key_enc IS NOT NULL OR tp.live_secret_key_enc IS NOT NULL);
  RAISE NOTICE 'psp connections now: %, still-unattached credentialed rows: %', n, orphans;
  IF n = 0 THEN
    RAISE EXCEPTION 'psp backfill produced no connections — the account tier is still empty for PSPs';
  END IF;
END;
$$;
