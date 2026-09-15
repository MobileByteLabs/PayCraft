-- 117_onboarding_state.sql — the onboarding source of truth.
--
-- PayCraft had no record of how far anyone got. Onboarding progress lived in `useState<Step>` on one
-- dashboard page, so a refresh erased it, and no table in the schema matched %onboard%/%setup%/%state%.
-- Nothing could resume a half-finished customer or a half-finished app.
--
-- Two tables rather than one discriminated table: the scopes have different keys (`owner_user_id`
-- vs `tenant_id`), different lifetimes, and different foreign keys. A single table would need a
-- nullable FK pair plus a CHECK to keep exactly one of them populated — more machinery than two
-- tables, and it would make the RLS policies harder to read, which is where correctness lives here.
--
-- THE KEYSTONE is the trigger in section 4. A step cannot reach status='passed' with a null
-- evidence field. That turns "no skip" from a convention a runtime is asked to honour into a
-- constraint the database enforces against every writer — command, dashboard, agent, or a future
-- refactor that forgets the rule existed.
--
-- Motivation, measured on production 2026-09-15: six defects where a row existed so something
-- reported green while the app was unsellable (cappy had no tenant_paywall row and shipped a
-- wellness paywall advertising "HD downloads"; Razorpay's LIVE slot held an rzp_test_ key while
-- is_active read true). The common shape is a structural check standing in for a functional one.

-- ── Section 1/6 — the closed blocked_reason enum ─────────────────────────────────────────────────
-- These four are the ONLY legitimate stalls the runtime can produce. 'awaiting-human-signin' is
-- deliberately absent: the account API key (migration 118) removes interactive sign-in entirely, so
-- a step reporting it would be codifying a bug rather than describing a state.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_blocked_reason') THEN
    CREATE TYPE onboarding_blocked_reason AS ENUM (
      'pending-provider-credential',
      'pending-account-api-key',
      'provider-api-unavailable',
      'pending-device-verify'
    );
  END IF;
END $$;

-- ── Section 2/6 — customer state ─────────────────────────────────────────────────────────────────
-- One row per account owner, and it exists before any tenant does — which is what lets the four
-- arrival paths collapse into one reconcile: "signed up but no apps yet" is simply a completed
-- C-chain with no A-row beside it.
CREATE TABLE IF NOT EXISTS onboarding_customer_state (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step  text        NOT NULL DEFAULT 'C1',
  steps         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_customer_state_steps_is_array') THEN
    ALTER TABLE onboarding_customer_state
      ADD CONSTRAINT onboarding_customer_state_steps_is_array
      CHECK (jsonb_typeof(steps) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ocs_current_step ON onboarding_customer_state(current_step);

-- ── Section 3/6 — app state ──────────────────────────────────────────────────────────────────────
-- One row per tenant, many per owner. A0 is "customer onboarding complete" — the rung that makes
-- "existing account adds another app" identical to every other arrival.
CREATE TABLE IF NOT EXISTS onboarding_app_state (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  current_step text        NOT NULL DEFAULT 'A0',
  steps        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_app_state_steps_is_array') THEN
    ALTER TABLE onboarding_app_state
      ADD CONSTRAINT onboarding_app_state_steps_is_array
      CHECK (jsonb_typeof(steps) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oas_current_step ON onboarding_app_state(current_step);

-- ── Section 4/6 — the evidence trigger (THE KEYSTONE) ────────────────────────────────────────────
-- Rejects two shapes in NEW.steps:
--   (a) any step with status='passed' and no evidence                              (AC-1)
--   (b) any step with status='blocked' whose reason is outside the closed enum     (AC-2)
--
-- A CHECK constraint was the alternative and loses on diagnosability: it cannot iterate the jsonb
-- array legibly, and it surfaces as an opaque `check_violation` naming the constraint rather than
-- the step. When this fires months from now, the difference is whether the operator can tell WHICH
-- step lacked evidence. The trigger raises with the step id.
--
-- The closed set is enforced by CASTING INTO THE ENUM, not by a text `NOT IN (...)` list. The enum
-- is then the single source of truth: a value added to the type shows up in `enum_range`, and a
-- value outside it raises invalid_text_representation. A hand-maintained list drifts the first time
-- someone adds a reason and forgets this function exists.
CREATE OR REPLACE FUNCTION onboarding_state_evidence_check()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  step    jsonb;
  sid     text;
  sstatus text;
  sreason text;
BEGIN
  FOR step IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.steps, '[]'::jsonb)) LOOP
    sid     := step->>'id';
    sstatus := step->>'status';
    sreason := step->>'blocked_reason';

    -- `step->'evidence' IS NULL` catches an absent key; `= 'null'::jsonb` catches an explicit null.
    -- Both are the same claim — "passed without proof" — and only checking one leaves the other open.
    IF sstatus = 'passed' AND (step->'evidence' IS NULL OR step->'evidence' = 'null'::jsonb) THEN
      RAISE EXCEPTION
        'onboarding step % cannot reach status=passed with evidence IS NULL (AC-1: no-skip)', sid
        USING ERRCODE = '23514';
    END IF;

    IF sstatus = 'blocked' THEN
      IF sreason IS NULL THEN
        RAISE EXCEPTION 'onboarding step % blocked without blocked_reason (AC-2)', sid
          USING ERRCODE = '23514';
      END IF;
      PERFORM sreason::onboarding_blocked_reason;
    END IF;
  END LOOP;

  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION onboarding_state_evidence_check() IS
  'AC-1/AC-2 keystone: a step cannot be passed without evidence, nor blocked without a reason from the closed enum.';

-- ── Section 5/6 — bind the trigger to both tables ────────────────────────────────────────────────
-- `OF steps` rather than a blanket UPDATE: bumping current_step or completed_at alone does not
-- re-scan the array, so the common write stays cheap.
DROP TRIGGER IF EXISTS trg_ocs_evidence_check ON onboarding_customer_state;
CREATE TRIGGER trg_ocs_evidence_check
  BEFORE INSERT OR UPDATE OF steps ON onboarding_customer_state
  FOR EACH ROW EXECUTE FUNCTION onboarding_state_evidence_check();

DROP TRIGGER IF EXISTS trg_oas_evidence_check ON onboarding_app_state;
CREATE TRIGGER trg_oas_evidence_check
  BEFORE INSERT OR UPDATE OF steps ON onboarding_app_state
  FOR EACH ROW EXECUTE FUNCTION onboarding_state_evidence_check();

-- ── Section 6/6 — RLS ────────────────────────────────────────────────────────────────────────────
-- The Phase 1 scoped JWT carries auth.uid() = owner_user_id, so a command authenticating with an
-- account key is filtered to that account's own rows by the same policy that filters the dashboard.
-- One enforcement path for both clients is the point: it is what makes "one SoT, two clients" safe.
ALTER TABLE onboarding_customer_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_app_state      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ocs_owner_rw ON onboarding_customer_state;
CREATE POLICY ocs_owner_rw ON onboarding_customer_state
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- App state is reached through tenant_admins, matching how every other tenant-scoped table in this
-- schema authorizes — a second, divergent notion of "may touch this app" is how the two-truths bug
-- in tenant_provider_resolve happened.
DROP POLICY IF EXISTS oas_owner_rw ON onboarding_app_state;
CREATE POLICY oas_owner_rw ON onboarding_app_state
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_admins ta
                  WHERE ta.tenant_id = onboarding_app_state.tenant_id
                    AND ta.user_id   = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_admins ta
                       WHERE ta.tenant_id = onboarding_app_state.tenant_id
                         AND ta.user_id   = auth.uid()));

-- Supabase grants `anon` full table privileges on public tables by default. RLS already returns no
-- rows to anon (there is no anon policy), so this is not an exposure — but it is the same
-- defence-in-depth migrations 105/107 applied to functions, and it costs nothing: a future policy
-- mistake should not be one line away from becoming a data leak.
REVOKE ALL ON public.onboarding_customer_state FROM anon;
REVOKE ALL ON public.onboarding_app_state      FROM anon;

COMMENT ON TABLE onboarding_customer_state IS
  'Per-account onboarding progress (C1..C3). Steps carry evidence; the trigger refuses a pass without it.';
COMMENT ON TABLE onboarding_app_state IS
  'Per-tenant onboarding progress (A0..A7). Steps carry evidence; the trigger refuses a pass without it.';
