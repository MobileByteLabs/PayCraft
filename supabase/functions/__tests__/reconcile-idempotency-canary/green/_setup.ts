// supabase/functions/__tests__/reconcile-idempotency-canary/green/_setup.ts
// MUST be the first import in the green test: the shared supabase-admin client is constructed at
// module load from these env vars, so they have to exist before entitlement-reconcile.ts evaluates.
Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
