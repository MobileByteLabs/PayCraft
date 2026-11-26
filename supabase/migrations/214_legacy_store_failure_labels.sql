-- 214 — store failures from SDKs older than attempt tracking say WHY (paycraft-attempt-observability sub-plan 07).
--
-- An app on an SDK before 210 records a failed Play / App Store purchase through record_store_attempt (188) and
-- then its reason (201's UPDATE of failure_reason). 210 closed such a row as 'failed' but left stage, error_class
-- and error_code empty, so Payment health showed "89 failed" for Reels Downloader with no cause — while 69 of those
-- rows said 'product_not_found'. This labels them exactly as the current SDK labels its own store failures
-- (PayCraftBillingManager: stage provider, error_class = classifyStoreCode(code), error_code = code):
--   * paycraft_store_failure_class(code) — the SQL mirror of classifyStoreCode (test 214 pins them together)
--   * a trigger: when a reason lands on a failed row with no stage, fill the three columns
--   * paycraft_label_legacy_store_failures() — the backfill, run once here
-- A row the SDK already labelled is never touched; an abandon is never given a failure stage.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; the backfill only touches unlabelled rows.

CREATE OR REPLACE FUNCTION public.paycraft_store_failure_class(p_code TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_code IS NULL                              THEN 'store_other'
    WHEN p_code LIKE 'connect\_%'                    THEN 'store_connect'
    WHEN p_code LIKE 'purchase\_%'                   THEN 'store_purchase'
    WHEN p_code LIKE 'launch\_%'                     THEN 'store_launch'
    WHEN p_code LIKE 'query\_%'                      THEN 'store_query'
    WHEN p_code = 'timeout'                          THEN 'timeout'
    WHEN p_code IN ('product_not_found', 'no_offer') THEN 'catalog'
    WHEN p_code = 'no_activity'                      THEN 'sdk_state'
    ELSE 'store_other'
  END
$$;

CREATE OR REPLACE FUNCTION public.attempt_label_legacy_failure() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome = 'payment_failed' AND NEW.stage IS NULL AND NEW.failure_reason IS NOT NULL THEN
    NEW.stage       := 'provider';
    NEW.error_code  := coalesce(NEW.error_code, NEW.failure_reason);
    NEW.error_class := coalesce(NEW.error_class, public.paycraft_store_failure_class(NEW.failure_reason));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS checkout_attempts_legacy_failure ON public.checkout_attempts;
CREATE TRIGGER checkout_attempts_legacy_failure BEFORE INSERT OR UPDATE OF failure_reason ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_label_legacy_failure();

CREATE OR REPLACE FUNCTION public.paycraft_label_legacy_store_failures() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE checkout_attempts
     SET stage       = 'provider',
         error_code  = coalesce(error_code, failure_reason),
         error_class = coalesce(error_class, paycraft_store_failure_class(failure_reason))
   WHERE outcome = 'payment_failed' AND stage IS NULL AND failure_reason IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.paycraft_label_legacy_store_failures() FROM PUBLIC, anon, authenticated;

SELECT public.paycraft_label_legacy_store_failures();
