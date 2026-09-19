-- 129_tenant_config_cache_ttl.sql
--
-- Make the SDK's config cache TTL a per-tenant SETTING instead of a constant in the edge function.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
-- The SDK is fully server-driven: prices, paywall copy, provider routing and store bindings all
-- arrive in the /config payload. The TTL is therefore not a caching detail — it is how long a change
-- an operator makes in the dashboard stays INVISIBLE on a device. At the old 3600 every support
-- answer began with "wait up to an hour", and an operator who fixed a wrong price could not tell a
-- failed fix from an unpropagated one.
--
-- Different apps genuinely want different answers: a team iterating on a paywall wants seconds, a
-- shipped app with a stable catalogue would rather spend fewer requests. Hardcoding one number
-- serves neither, so it becomes a setting with a sensible default.
--
-- BOUNDS ARE LOAD-BEARING, ESPECIALLY THE FLOOR
-- `cache_ttl_seconds = 0` is not "never cache" to this SDK — it is the STALE SENTINEL.
-- `ConfigCache.read()` hands back a copy with `cacheTtlSeconds = 0` to mean "this config is
-- expired", and `PayCraft.kt` tests `cached.cacheTtlSeconds == 0` to decide staleness. A tenant who
-- set 0 hoping for "always fresh" would instead make every cached read look expired forever. The
-- CHECK makes that unreachable rather than documenting it and hoping.
--
-- The 30s floor also protects the tenant from themselves: /config is rate limited per tenant, and a
-- TTL below the limiter's refill would have devices fetching faster than they are allowed to.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS config_cache_ttl_seconds integer NOT NULL DEFAULT 300;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_config_cache_ttl_seconds_range'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_config_cache_ttl_seconds_range
      CHECK (config_cache_ttl_seconds BETWEEN 30 AND 86400);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.config_cache_ttl_seconds IS
  'Seconds a device may serve its cached /config before revalidating. Default 300. Range 30..86400; '
  '0 is FORBIDDEN because the SDK uses cacheTtlSeconds=0 as its "stale" sentinel, so 0 would make '
  'every cached read appear permanently expired.';

-- Read: any tenant admin. Returns the effective value so the dashboard never has to guess a default.
CREATE OR REPLACE FUNCTION public.tenant_config_ttl_get(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ttl integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT config_cache_ttl_seconds INTO v_ttl FROM tenants WHERE id = p_tenant_id;
  RETURN v_ttl;
END;
$function$;

-- Write: clamp rather than reject.
--
-- A slider or a typed number that silently refuses is worse than one that lands on the nearest legal
-- value and says so — the caller gets back what was ACTUALLY stored, so the UI can show the truth
-- instead of the request.
CREATE OR REPLACE FUNCTION public.tenant_config_ttl_set(p_tenant_id uuid, p_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_clamped integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_clamped := greatest(30, least(86400, coalesce(p_seconds, 300)));

  UPDATE tenants SET config_cache_ttl_seconds = v_clamped WHERE id = p_tenant_id;
  RETURN v_clamped;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_config_ttl_get(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_config_ttl_get(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.tenant_config_ttl_set(uuid, integer) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_config_ttl_set(uuid, integer) TO authenticated, service_role;
