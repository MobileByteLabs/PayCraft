// supabase/functions/__tests__/receipt-validate-canary/green/_setup.ts
// MUST be the first import: the shared supabase-admin client (used by assertPlayTokenNotReused)
// is constructed from these env vars at module load, before receipt-validate.ts evaluates.
Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
