// supabase/functions/__tests__/apple-jwt-tenant-canary/green/_setup.ts
// MUST be the first import: the shared supabase-admin client (used by tenantAppStoreServerJwt)
// is constructed from these env vars at module load, before apple-jwt.ts evaluates.
Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
