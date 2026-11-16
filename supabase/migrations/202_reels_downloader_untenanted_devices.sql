-- 202 — give Reels Downloader's untenanted sign-ins their app (2026-11-17).
--
-- WHAT THEY ARE
-- 12 registered_devices rows (7 people, all Android, live, 2026-07-22 → 2026-09-21) with tenant_id NULL:
-- older Reels Downloader builds called register_device without p_api_key, so resolve_tenant had nothing to
-- resolve. Every one of those 7 people also has Reels Downloader-tenanted rows; none has a subscription.
-- Left NULL they sit outside the app — the owner's counts miss them and their seats are counted against an
-- empty "no app" bucket instead of Reels Downloader's device limit.
--
-- THE FIX
-- Assign them to Reels Downloader. Only rows whose person signs in to Reels Downloader and to no other app
-- are moved, so a future untenanted row from someone else is not misattributed. Nothing is deleted.
-- Idempotent: a re-run finds no NULL-tenant rows that qualify.

UPDATE registered_devices d
SET tenant_id = 'bba1842f-3a57-41cd-8705-94db588de056'
WHERE d.tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM registered_devices x
    WHERE lower(x.email) = lower(d.email) AND x.tenant_id = 'bba1842f-3a57-41cd-8705-94db588de056')
  AND NOT EXISTS (
    SELECT 1 FROM registered_devices y
    WHERE lower(y.email) = lower(d.email) AND y.tenant_id IS NOT NULL
      AND y.tenant_id <> 'bba1842f-3a57-41cd-8705-94db588de056');
