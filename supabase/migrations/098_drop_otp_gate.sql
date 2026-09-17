-- 098_drop_otp_gate.sql
--
-- Removes the emailed one-time-code gate entirely (operator decision, 2026-09-06: "we are using
-- OAuth, that is enough").
--
-- WHAT THIS GATE WAS
-- PayCraft binds a subscription to an email. Using that email on a second device raises
-- BillingState.DeviceConflict, which offered three ways to prove ownership:
--   Gate 1  OAuth — Google / Apple sign-in.
--   Gate 2  OTP   — a 6-digit code emailed via Brevo. check_otp_gate() reported whether the
--                   PLATFORM-WIDE daily budget (otp_send_log, keyed by date, 300/day = Brevo's
--                   free-tier ceiling) still had room; record_otp_send() incremented it.
--   Gate 3  Manual — a pre-filled support email.
-- Gate 2 is gone. Gate 3 becomes Gate 2 and is now the only fallback.
--
-- THE TRADE-OFF, RECORDED SO IT IS NOT REDISCOVERED BY SURPRISE
-- OTP existed specifically for custom-domain emails that cannot be linked to a Google or Apple
-- account. Those users no longer have a self-service route out of a device conflict — they reach
-- the support email directly. For a consumer base on Gmail/iCloud this costs nothing; for business
-- customers on their own domains it converts a self-service recovery into a support ticket.
--
-- A NOTE ON THE ATTACK THIS ALSO RETIRES
-- record_otp_send() was anon-executable until migration 094. Because otp_send_log is a single
-- global counter, any holder of the public anon key could have called it 300 times and disabled
-- OTP verification platform-wide for every tenant — a cheap, unauthenticated denial of the
-- ownership-verification path that would have looked like a Brevo outage. Dropping the mechanism
-- removes the counter along with the gate.
--
-- ORDER MATTERS: the functions are dropped before the table they read/write, so neither drop
-- depends on an object that is already gone. All are IF EXISTS — this migration is idempotent and
-- safe on a database where an earlier partial cleanup already ran.

-- BOTH check_otp_gate overloads. Postgres keeps every signature, and dropping one leaves the other
-- live — the same trap that left an anon-executable upgrade_tenant_plan behind in 094 until a
-- pg_proc probe caught it. Enumerate signatures, never assume one.
--
-- The 3-arg overload is worth a specific note: its body is a STUB that ignores p_otp entirely and
-- unconditionally returns jsonb_build_object('valid', true), under a comment reading
-- "Implementation depends on OTP table structure." Anything that called it to validate a code would
-- have accepted EVERY code. Nothing in the SDK or dashboard calls it (the SDK used the 1-arg budget
-- overload), so this was latent rather than exploited — but it is exactly the kind of always-true
-- validator that should never outlive the feature it was stubbed for.
DROP FUNCTION IF EXISTS public.check_otp_gate(INT);
DROP FUNCTION IF EXISTS public.check_otp_gate(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_otp_send();

-- Policies are dropped explicitly rather than relying on the table drop, so the intent is visible
-- in the migration text and a future reader does not have to know that DROP TABLE takes them too.
DROP POLICY IF EXISTS "anon_read_otp_log"    ON public.otp_send_log;
DROP POLICY IF EXISTS "service_write_otp_log" ON public.otp_send_log;

DROP TABLE IF EXISTS public.otp_send_log;

-- The companion Supabase Auth Hook (supabase/functions/otp-send-hook/) is deleted in the same
-- change. It existed only to increment otp_send_log after each OTP email; with the table gone it
-- would fail on every invocation. If this database still has the hook wired in
-- Dashboard → Auth → Hooks → Send Email, unwire it there — a hook registration lives in Supabase
-- project config, not in schema, so no migration can remove it.
