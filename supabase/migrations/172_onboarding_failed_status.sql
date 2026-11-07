-- 172_onboarding_failed_status.sql — a step can be recorded as FAILED, and only with the failure.
--
-- The onboarding runtime's contract (rule 5): a passed step whose re-verification fails must be
-- DEMOTED with the failure evidence before it is healed, so the SoT shows the app was broken. The
-- vocabulary had no word for that — only `passed` and `blocked` — and `blocked` means "waiting on
-- something external" from a closed enum, which a drifted claim is not. So the only way to record
-- "A5 said sellable; the store says MISSING_METADATA" was not to record it, and the heal erased it.
--
-- `failed` carries the same requirement as `passed`: non-null evidence. For a failure the evidence
-- IS the observation (what the probe saw), so a `failed` with no evidence is a claim of breakage
-- with nothing attached — the mirror of the passed-without-proof case 117 exists to refuse.
--
-- The status set itself is still NOT closed here. Rows written before this migration may carry
-- other values, and the trigger re-scans the whole array on every write, so closing it would turn
-- one stale step into an unwritable row. The route closes the set for every new write instead.
--
-- Idempotent: CREATE OR REPLACE of the trigger function only; the triggers from 117 bind by name.

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
    IF sstatus = 'passed' AND (step->'evidence' IS NULL OR step->'evidence' = 'null'::jsonb) THEN
      RAISE EXCEPTION
        'onboarding step % cannot reach status=passed with evidence IS NULL (AC-1: no-skip)', sid
        USING ERRCODE = '23514';
    END IF;

    IF sstatus = 'failed' AND (step->'evidence' IS NULL OR step->'evidence' = 'null'::jsonb) THEN
      RAISE EXCEPTION
        'onboarding step % cannot be recorded status=failed without evidence of the observed failure', sid
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
  'AC-1/AC-2 keystone: a step cannot be passed or failed without evidence, nor blocked without a reason from the closed enum.';
