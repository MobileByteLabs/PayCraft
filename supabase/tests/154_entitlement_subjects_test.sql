-- Assertions for migration 154 (entitlement subjects + identity aliases).
--
-- Run against a LOCAL database only — it writes fixture rows:
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/154_entitlement_subjects_test.sql
--
-- Every assertion RAISES on failure, so a non-zero exit is the whole verdict. Written as a script
-- rather than a checklist because the migration's value is entirely in its refusals: the happy path
-- is three inserts, and the parts worth protecting are the two links it must NOT make.
--
-- Fixture mirrors the production shape measured 2026-10-16: 6 subscriptions, 3 with a matching
-- auth.users row and 3 without (Stripe payment-link buyers who never signed in).

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
  s_email   UUID;
  s_email2  UUID;
  s_other   UUID;
  caught    TEXT;
BEGIN
  -- ── Resolve ────────────────────────────────────────────────────────────────────────────────────

  -- Mixed case must fold: the same human typed it two ways at two checkouts.
  s_email  := entitlement_subject_resolve('email', NULL, 'Case@Test.Local', false);
  s_email2 := entitlement_subject_resolve('email', NULL, 'case@test.local', false);
  INSERT INTO _t VALUES ('case-folding', s_email = s_email2, s_email || ' vs ' || s_email2);

  -- Resolving twice must not mint twice.
  INSERT INTO _t VALUES (
    'resolve-idempotent',
    entitlement_subject_resolve('email', NULL, 'case@test.local', false) = s_email,
    NULL);

  -- An OAuth subject is opaque: case must NOT be folded, or two people collide into one subject.
  INSERT INTO _t VALUES (
    'oauth-value-is-case-sensitive',
    entitlement_subject_resolve('oauth', 'google', 'SUB-abc', true)
      <> entitlement_subject_resolve('oauth', 'google', 'sub-abc', true),
    NULL);

  -- ── The cross-device fix ───────────────────────────────────────────────────────────────────────
  -- Bought by email, later signs in with Apple using a private-relay address. The verified apple
  -- subject must land on the SAME entitlement, or the subscriber is not premium on device two.
  PERFORM entitlement_identity_link(s_email, 'oauth', 'apple', 'apple-sub-relay', true);
  INSERT INTO _t VALUES (
    'apple-relay-finds-earlier-purchase',
    entitlement_subject_resolve('oauth', 'apple', 'apple-sub-relay', true) = s_email,
    NULL);

  -- Linking the same identity again is a no-op, not an error.
  INSERT INTO _t VALUES (
    'link-idempotent',
    entitlement_identity_link(s_email, 'oauth', 'apple', 'apple-sub-relay', true) = s_email,
    NULL);

  -- An identity can become verified later; it must never be demoted by an unverified sighting.
  PERFORM entitlement_subject_resolve('oauth', 'apple', 'apple-sub-relay', false);
  INSERT INTO _t VALUES (
    'verified-is-never-demoted',
    (SELECT verified FROM entitlement_identities
      WHERE kind = 'oauth' AND provider = 'apple' AND value = 'apple-sub-relay'),
    NULL);

  -- ── The refusals ───────────────────────────────────────────────────────────────────────────────

  -- ACCOUNT TAKEOVER. A subject whose only identity is an unverified checkout email must not accept
  -- another unverified identity: anyone who can type an email would inherit the subscription.
  s_other := entitlement_subject_resolve('email', NULL, 'unverified-only@test.local', false);
  caught := NULL;
  BEGIN
    PERFORM entitlement_identity_link(s_other, 'email', NULL, 'attacker@evil.test', false);
  EXCEPTION WHEN insufficient_privilege THEN caught := SQLERRM;
  END;
  INSERT INTO _t VALUES ('refuses-unverified-to-unverified', caught IS NOT NULL, caught);

  -- …but a VERIFIED identity may attach to that same subject. This is the legitimate path: the
  -- buyer proves who they are, and their earlier purchase follows.
  INSERT INTO _t VALUES (
    'allows-verified-onto-unverified-subject',
    entitlement_identity_link(s_other, 'oauth', 'google', 'google-sub-legit', true) = s_other,
    NULL);

  -- SILENT MERGE. An identity owned by another subject must not be stolen — whose entitlement
  -- survives is an operator decision, never an implicit one.
  caught := NULL;
  BEGIN
    PERFORM entitlement_identity_link(s_other, 'oauth', 'apple', 'apple-sub-relay', true);
  EXCEPTION WHEN unique_violation THEN caught := SQLERRM;
  END;
  INSERT INTO _t VALUES ('refuses-silent-merge', caught IS NOT NULL, caught);

  -- An empty identity value resolves to nothing meaningful and must be refused, not stored.
  caught := NULL;
  BEGIN
    PERFORM entitlement_subject_resolve('email', NULL, '   ', false);
  EXCEPTION WHEN null_value_not_allowed THEN caught := SQLERRM;
  END;
  INSERT INTO _t VALUES ('refuses-empty-value', caught IS NOT NULL, caught);

  -- Shape constraint: oauth <=> provider.
  caught := NULL;
  BEGIN
    INSERT INTO entitlement_identities (subject_id, kind, provider, value)
    VALUES (s_email, 'oauth', NULL, 'no-provider');
  EXCEPTION WHEN check_violation THEN caught := SQLERRM;
  END;
  INSERT INTO _t VALUES ('refuses-oauth-without-provider', caught IS NOT NULL, caught);

  caught := NULL;
  BEGIN
    INSERT INTO entitlement_identities (subject_id, kind, provider, value)
    VALUES (s_email, 'email', 'google', 'provider-on-email@test.local');
  EXCEPTION WHEN check_violation THEN caught := SQLERRM;
  END;
  INSERT INTO _t VALUES ('refuses-provider-on-non-oauth', caught IS NOT NULL, caught);
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  failed INT;
  r      RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '154 entitlement-subject assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;  -- assertions only; leave no fixture behind
