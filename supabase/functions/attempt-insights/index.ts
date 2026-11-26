// supabase/functions/attempt-insights/index.ts — the edge entry. The run is engine.ts, the HTTP contract
// handler.ts, the model client anthropic.ts; this file only wires the real database, model and alert senders.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { anthropicClient } from "./anthropic.ts"
import { handleAttemptInsights } from "./handler.ts"

export function serveAttemptInsights(req: Request): Promise<Response> {
  return handleAttemptInsights(req, {
    env: (name) => Deno.env.get(name),
    db: () =>
      createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    llm: anthropicClient,
  })
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module must not bind a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(serveAttemptInsights)
}
