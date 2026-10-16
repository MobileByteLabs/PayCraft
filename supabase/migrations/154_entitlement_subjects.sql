-- 154 — a stable SUBJECT for entitlement, with email / OAuth / device as aliases.
--
-- ## The bug this fixes
--
-- Entitlement is keyed on `app_user_id`, which resolves to `email ?: deviceId`. An email is not a
-- stable identity:
--
--   A user subscribes on Android signing in with Google  -> a@gmail.com
--   installs on iOS, signs in with Apple "Hide My Email"  -> xyz@privaterelay.appleid.com
--   => two app_user_ids => the SUBSCRIBER IS NOT PREMIUM on their second device.
--
-- Apple relay addresses are per-app and per-user, so this fires for everyone who hides their email.
-- For a KMP product shipping both platforms that is the common path, not an edge case. Email also
-- breaks on a provider-side address change.
--
-- ## Why the obvious fix is wrong
--
-- "Key on auth.users.id" orphans paying customers. Measured in production 2026-10-16:
--
--   subscriptions                     6 rows (5 live, all Stripe)
--   ...with a matching auth.users row 3
--   ...WITHOUT one                    3     <- 3 of 5 live subscribers
--
-- Those three bought through a Stripe payment link: an email was captured at checkout and they
-- never signed in. That is a permanent category, not a backlog — a buyer can purchase without ever
-- authenticating. So the key must exist independently of whether an auth user does.
--
-- ## The shape
--
-- A SUBJECT is the stable entitlement key. Everything else is an ALIAS that resolves to it:
--
--   email  / null   / lower(email)  unverified   <- Stripe checkout
--   oauth  / google / <sub>         verified     <- idToken sign-in
--   oauth  / apple  / <sub>         verified     <- including private-relay users
--   device / null   / <deviceId>    unverified   <- anonymous purchase
--   auth_user / null / <auth.users.id> verified  <- Supabase minted it from a verified sign-in
--
-- The relay user's `apple.sub` links to the SAME subject as their earlier email purchase, which is
-- the moment the cross-device bug disappears.
--
-- ## Additive, deliberately
--
-- Nothing reads subjects yet. `entitlement_records.app_user_id` and `subscriptions.email` are
-- untouched, so this migration cannot change behaviour — the SDK switches over in a later step,
-- once the mapping is populated and verifiable. 6 rows is the cheapest this will ever be; at 10k
-- subscribers the same change is a far riskier operation.

-- ── Subjects ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_subjects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Human-readable breadcrumb for support ("whose subject is this?"). NEVER a key: it is the
    -- first email we saw and may be stale the moment the user changes it.
    first_seen_hint TEXT
);

COMMENT ON TABLE public.entitlement_subjects IS
  'The stable entitlement key. One row per PERSON; email/OAuth/device identities are aliases in entitlement_identities.';
COMMENT ON COLUMN public.entitlement_subjects.first_seen_hint IS
  'Support breadcrumb only (first email seen). Never resolve on this — use entitlement_identities.';

-- ── Identities ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_identities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES public.entitlement_subjects(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,          -- 'email' | 'oauth' | 'device' | 'auth_user'
    provider   TEXT,                   -- 'google' | 'apple' for kind='oauth', else NULL
    value      TEXT NOT NULL,          -- lower(email) | provider subject | deviceId
    -- Whether an IDENTITY PROVIDER attested this, not whether we like it. An OAuth subject is
    -- verified; an email typed into Stripe checkout is not. The link rule below depends on it.
    verified   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlement_identities_kind_check') THEN
    ALTER TABLE public.entitlement_identities
      ADD CONSTRAINT entitlement_identities_kind_check
      CHECK (kind IN ('email', 'oauth', 'device', 'auth_user'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlement_identities_provider_check') THEN
    -- An oauth identity without a provider is unresolvable; a non-oauth one with a provider is
    -- ambiguous. Both are refused rather than normalised, so a bad write fails loudly at insert.
    ALTER TABLE public.entitlement_identities
      ADD CONSTRAINT entitlement_identities_provider_check
      CHECK ((kind = 'oauth') = (provider IS NOT NULL));
  END IF;
END $$;

-- One identity resolves to exactly one subject. `provider` is nullable, so COALESCE into the index
-- or NULLs would compare unequal and let the same email be inserted many times.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_identity
    ON public.entitlement_identities (kind, COALESCE(provider, ''), value);

CREATE INDEX IF NOT EXISTS idx_entitlement_identity_subject
    ON public.entitlement_identities (subject_id);

COMMENT ON TABLE public.entitlement_identities IS
  'Aliases that resolve to an entitlement subject. UNIQUE per (kind, provider, value).';

-- Identity data: service_role only. No tenant admin has a reason to read another account's
-- identities, and nothing client-side should reach these at all.
ALTER TABLE public.entitlement_subjects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entitlement_subjects   FROM anon, authenticated;
REVOKE ALL ON public.entitlement_identities FROM anon, authenticated;

-- ── Resolve ──────────────────────────────────────────────────────────────────────────────────────
-- Given any identity, answer "whose entitlement is this?", minting a subject when the identity is
-- new. Idempotent: the same identity always returns the same subject.
CREATE OR REPLACE FUNCTION public.entitlement_subject_resolve(
    p_kind     TEXT,
    p_provider TEXT,
    p_value    TEXT,
    p_verified BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value   TEXT;
  v_subject UUID;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RAISE EXCEPTION 'identity value is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Emails are case-insensitive; an OAuth subject and a device id are opaque and must NOT be
  -- case-folded, or two distinct subjects could collide into one.
  v_value := CASE WHEN p_kind = 'email' THEN lower(btrim(p_value)) ELSE btrim(p_value) END;

  SELECT subject_id INTO v_subject
  FROM entitlement_identities
  WHERE kind = p_kind AND COALESCE(provider, '') = COALESCE(p_provider, '') AND value = v_value;

  IF v_subject IS NOT NULL THEN
    -- An identity can become verified later (a checkout email the user then signs in with).
    -- Promote, never demote: a verified alias must not be downgraded by an unverified sighting.
    IF p_verified THEN
      UPDATE entitlement_identities SET verified = true
      WHERE kind = p_kind AND COALESCE(provider, '') = COALESCE(p_provider, '') AND value = v_value
        AND verified = false;
    END IF;
    RETURN v_subject;
  END IF;

  INSERT INTO entitlement_subjects (first_seen_hint)
  VALUES (CASE WHEN p_kind = 'email' THEN v_value ELSE NULL END)
  RETURNING id INTO v_subject;

  INSERT INTO entitlement_identities (subject_id, kind, provider, value, verified)
  VALUES (v_subject, p_kind, p_provider, v_value, COALESCE(p_verified, false));

  RETURN v_subject;
END;
$$;

COMMENT ON FUNCTION public.entitlement_subject_resolve(TEXT, TEXT, TEXT, BOOLEAN) IS
  'Resolve any identity to its entitlement subject, minting one when unseen. Idempotent.';

-- ── Link ─────────────────────────────────────────────────────────────────────────────────────────
-- Attach an identity to an EXISTING subject — the call that makes a relay-email sign-in find a
-- purchase made earlier under a different address.
CREATE OR REPLACE FUNCTION public.entitlement_identity_link(
    p_subject  UUID,
    p_kind     TEXT,
    p_provider TEXT,
    p_value    TEXT,
    p_verified BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value    TEXT;
  v_existing UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entitlement_subjects WHERE id = p_subject) THEN
    RAISE EXCEPTION 'no such subject' USING ERRCODE = 'no_data_found';
  END IF;

  v_value := CASE WHEN p_kind = 'email' THEN lower(btrim(p_value)) ELSE btrim(p_value) END;

  SELECT subject_id INTO v_existing
  FROM entitlement_identities
  WHERE kind = p_kind AND COALESCE(provider, '') = COALESCE(p_provider, '') AND value = v_value;

  IF v_existing = p_subject THEN
    RETURN p_subject;                       -- already linked; idempotent
  END IF;

  IF v_existing IS NOT NULL THEN
    -- Two subjects claim one identity. MERGING is a destructive decision about whose entitlement
    -- survives, so it is refused here and left to an explicit operator action.
    RAISE EXCEPTION 'identity already resolves to a different subject: %', v_existing
      USING ERRCODE = 'unique_violation';
  END IF;

  -- THE SAFETY RULE. Linking joins two identities into one entitlement, so at least one side must
  -- be attested by an identity provider. Linking two UNVERIFIED identities would let anyone who can
  -- type an email address inherit a stranger's subscription.
  IF NOT p_verified AND NOT EXISTS (
      SELECT 1 FROM entitlement_identities WHERE subject_id = p_subject AND verified
  ) THEN
    RAISE EXCEPTION 'refusing to link an unverified identity to a subject with no verified identity'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO entitlement_identities (subject_id, kind, provider, value, verified)
  VALUES (p_subject, p_kind, p_provider, v_value, COALESCE(p_verified, false));

  RETURN p_subject;
END;
$$;

COMMENT ON FUNCTION public.entitlement_identity_link(UUID, TEXT, TEXT, TEXT, BOOLEAN) IS
  'Attach an identity to an existing subject. Refuses to link two unverified identities, and refuses a merge.';

REVOKE ALL ON FUNCTION public.entitlement_subject_resolve(TEXT, TEXT, TEXT, BOOLEAN) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.entitlement_identity_link(UUID, TEXT, TEXT, TEXT, BOOLEAN)  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.entitlement_subject_resolve(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.entitlement_identity_link(UUID, TEXT, TEXT, TEXT, BOOLEAN)  TO service_role;

-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────
-- Every existing subscription email becomes a subject. Unverified: a Stripe checkout email is
-- attested by a payment, not by an identity provider — which is exactly the state the link rule
-- above is written for.
--
-- Where an auth.users row shares that email, its OAuth identity is linked to the SAME subject, so
-- those buyers are already cross-device correct before the SDK ever switches over.
DO $$
DECLARE
  sub_email RECORD;
  auth_row  RECORD;   -- a DISTINCT variable: reusing the outer one clobbers the email mid-loop
  v_subject UUID;
BEGIN
  FOR sub_email IN
    SELECT DISTINCT lower(btrim(email)) AS email FROM subscriptions WHERE email IS NOT NULL
  LOOP
    v_subject := entitlement_subject_resolve('email', NULL, sub_email.email, false);

    FOR auth_row IN SELECT u.id FROM auth.users u WHERE lower(u.email) = sub_email.email LOOP
      -- The auth user id is its OWN kind, not an oauth subject: `raw_app_meta_data->>'provider'`
      -- is 'email' for a password user, which is not an OAuth provider and would violate the
      -- oauth<=>provider constraint. Verified because Supabase minted it from a real sign-in.
      PERFORM entitlement_identity_link(v_subject, 'auth_user', NULL, auth_row.id::text, true);
    END LOOP;
  END LOOP;
END $$;
