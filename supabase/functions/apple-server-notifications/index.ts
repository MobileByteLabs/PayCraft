// supabase/functions/apple-server-notifications/index.ts
//
// Ingest Apple App Store Server Notifications V2 (ASSN-V2). The work — JWS verify, re-fetch truth
// from the App Store Server API, reconcile ONE canonical record — lives in
// _shared/apple-notification.ts, shared with store-sync's Notification History backfill.
//
// Endpoint (E6 wiring): set this URL as the App Store Server Notifications V2 URL in App Store
// Connect. Live signing credentials for the re-fetch are provided via apple-jwt.ts env in E6.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { processAppleNotification } from "../_shared/apple-notification.ts";

serve(async (req: Request) => {
  try {
    const body = await req.json();
    // ASSN-V2 delivers { signedPayload } — a JWS whose payload holds notificationType + data.
    await processAppleNotification(body.signedPayload);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("apple-server-notifications error:", (err as Error).message);
    // 4xx so Apple retries transient failures without wedging on a permanent bad payload.
    return new Response((err as Error).message, { status: 400 });
  }
});
