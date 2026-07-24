// supabase/functions/_shared/supabase-admin.ts
// Shared service-role Supabase client for the E2 reconciliation engine.
// Edge functions always run with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY injected;
// the client is constructed once at module load and reused by every reconcile/receipt path.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
